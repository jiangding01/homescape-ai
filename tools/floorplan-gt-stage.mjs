#!/usr/bin/env node
// Stage only human-reviewed GT with pinned SHA-256; never promote a Candidate.
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { getGroundTruthCalibrationBasisErrors } from './floorplan-gt-calibration.mjs'

const hash = (x) => createHash('sha256').update(x).digest('hex')
const hex = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)
const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const fail = (s) => { throw Error(s) }
const types = {
  quality:['clean','compressed','blurred','scanned'],
  geometry:['rectangular','l_shape','irregular'],
  annotation:['full_dimension','partial_dimension','no_dimension'],
  layout:['single_room','open_plan','multi_room'],
  symbols:['standard','mixed','unknown'],
  textDensity:['sparse','normal','dense','overlap'],
}
function inside(root, target, label, allowRoot=false) {
  const rel = relative(root,target)
  if ((!rel && !allowRoot) || rel === '..' || rel.startsWith('..'+sep) || isAbsolute(rel)) fail(label+' 路径越界')
}
function relativePath(value,label) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\') ||
      value.split('/').some(p=>!p || p==='.' || p==='..')) fail(label+' 需要不越界的相对路径')
  return value
}
async function readLocal(root,name,label) {
  const target=resolve(root,relativePath(name,label))
  inside(root,target,label)
  const actual=await realpath(target)
  inside(await realpath(root),actual,label)
  if (!(await lstat(actual)).isFile()) fail(label+' 不是文件')
  return readFile(actual)
}
async function exists(root,name,label) {
  try { await readLocal(root,name,label); return true }
  catch(e) { if (e?.code==='ENOENT') return false; throw e }
}
async function save(root,name,data) {
  const target=resolve(root,name)
  inside(root,target,'输出路径')
  await mkdir(dirname(target),{recursive:true})
  inside(await realpath(root),await realpath(dirname(target)),'输出目录',true)
  try {
    const s=await lstat(target)
    if (!s.isFile() || s.isSymbolicLink()) fail('输出目标不得是链接或目录')
    if (await readFile(target,'utf8')===data) return
  } catch(e) { if (e?.code!=='ENOENT') throw e }
  const tmp=join(dirname(target),'.'+basename(target)+'.'+process.pid+'.tmp')
  try { await writeFile(tmp,data,{flag:'wx'}); await rename(tmp,target) }
  finally { await rm(tmp,{force:true}) }
}
function tagsOf(c) {
  if (!obj(c.tags)) fail(c.id+' 缺少审核 Tags')
  return Object.fromEntries(Object.entries(types).map(([key,allowed])=>{
    if (!allowed.includes(c.tags[key])) fail(c.id+'.tags.'+key+' 不合法')
    return [key,c.tags[key]]
  }))
}
async function main() {
  const args=process.argv.slice(process.argv[2] === '--' ? 3 : 2)
  const check=args.includes('--check')
  const filenames=args.filter(x=>x!=='--check')
  if (filenames.length!==1 || filenames[0].startsWith('-')) {
    fail('用法：node tools/floorplan-gt-stage.mjs <stage.json> [--check]')
  }
  const input=resolve(filenames[0]),root=dirname(input)
  const m=JSON.parse(await readLocal(root,basename(input),'Stage Manifest'))
  if (!obj(m) || m.schemaVersion!=='0.1.0' || typeof m.dataset!=='string' ||
      !m.dataset.trim() || !Array.isArray(m.cases) || !m.cases.length) fail('Stage Manifest 无效')
  const seen=new Set(),seenSources=new Set(),approved=[],states=[]
  for (const c of m.cases) {
    if (!obj(c) || typeof c.id!=='string' || !/^case-[a-z0-9_-]{1,48}$/.test(c.id) ||
        seen.has(c.id)) fail('Case ID 无效或重复')
    seen.add(c.id)
    if (!['pending','approved'].includes(c.reviewStatus)) fail(c.id+' reviewStatus 无效')
    const source=await readLocal(root,c.sourcePath,c.id+'.sourcePath')
    if (!hex(c.sourceSha256) || hash(source)!==c.sourceSha256) fail(c.id+' 原图 SHA-256 不一致')
    if (seenSources.has(c.sourceSha256)) fail(c.id+' 与其他 Case 使用了同一张原图')
    seenSources.add(c.sourceSha256)
    const suffix=extname(c.sourcePath).toLowerCase()
    if (c.mediaType==='image/jpeg') {
      if (!['.jpg','.jpeg'].includes(suffix)||source[0]!==255||source[1]!==216||source[2]!==255) fail(c.id+' JPEG 文件格式无效')
    } else if (c.mediaType==='image/png') {
      if (suffix!=='.png'||!source.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fail(c.id+' PNG 文件格式无效')
    } else fail(c.id+' 不支持的图片 MIME')
    relativePath(c.groundTruthPath,c.id+'.groundTruthPath')
    const present=await exists(root,c.groundTruthPath,c.id+'.groundTruthPath')
    if (c.reviewStatus==='approved') {
      if (c.tagsReviewed!==true || !hex(c.approvedGroundTruthSha256)) fail(c.id+' 缺少审核标签或 GT 审核哈希')
      if (!present) fail(c.id+' 缺少审核 GT 文件')
      const gtBytes=await readLocal(root,c.groundTruthPath,c.id+'.groundTruthPath')
      if (hash(gtBytes)!==c.approvedGroundTruthSha256) fail(c.id+' Ground Truth 内容已改变，须重新人工确认')
      const gt=JSON.parse(gtBytes)
      if (!obj(gt)||gt.schemaVersion!=='0.1.0'||gt.source?.kind!=='floorplan_image'||
          gt.source?.sourceLabel!==c.id||!Array.isArray(gt.rooms)||!gt.rooms.length||
          !Array.isArray(gt.openings)) fail(c.id+' GT 基础合同/Case ID 不匹配')
      const basisErrors=getGroundTruthCalibrationBasisErrors(gt)
      if (basisErrors.length) fail(c.id+' GT '+basisErrors.join('；'))
      approved.push({id:c.id,sourceKind:'floorplan_image',mediaType:c.mediaType,
        sourcePath:c.sourcePath,groundTruthPath:c.groundTruthPath,tags:tagsOf(c)})
    } else if (c.tagsReviewed===true || c.approvedGroundTruthSha256) {
      fail(c.id+' pending 不得声明已审核 GT 或 Tags')
    }
    states.push({caseId:c.id,status:c.reviewStatus,groundTruthFilePresent:present,
      ...(c.reviewStatus==='pending'?{next:present?'needs_human_approval':'needs_human_annotation'}:{})})
  }
  approved.sort((a,b)=>a.id.localeCompare(b.id))
  const progress={schemaVersion:'0.1.0',reportType:'real_floorplan_ground_truth_staging',
    dataset:m.dataset,totalCases:m.cases.length,approved:approved.length,
    pending:m.cases.length-approved.length,corpusReady:approved.length>0,
    benchmarkReady:false, note:'Only SHA-pinned human GT is staged. Official Corpus Gate still required.',cases:states}
  if (!check) {
    await save(root,'corpus-ready.json',JSON.stringify({schemaVersion:'0.1.0',dataset:m.dataset,cases:approved},null,2)+'\n')
    await save(root,'reports/gt-stage-progress.json',JSON.stringify(progress,null,2)+'\n')
  }
  process.stdout.write(JSON.stringify(progress,null,2)+'\n')
}
main().catch(e=>{process.stderr.write((e?.stack??String(e))+'\n');process.exitCode=1})
