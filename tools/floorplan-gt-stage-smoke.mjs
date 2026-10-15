import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const sha=x=>createHash('sha256').update(x).digest('hex')
const root=await mkdtemp(join(tmpdir(),'homescape-gt-stage-'))
const data=Buffer.from([255,216,255,1,2,3])
const data2=Buffer.from([255,216,255,4,5,6])
const gt=JSON.stringify({schemaVersion:'0.1.0',source:{kind:'floorplan_image',
  sourceLabel:'case-001'},rooms:[{}],openings:[]})
const tags={quality:'clean',geometry:'irregular',annotation:'partial_dimension',
  layout:'multi_room',symbols:'standard',textDensity:'normal'}
const manifest={schemaVersion:'0.1.0',dataset:'pilot-test',cases:[
  {id:'case-001',sourcePath:'sources/case-001.jpg',sourceSha256:sha(data),
    mediaType:'image/jpeg',groundTruthPath:'ground-truth/case-001.json',
    reviewStatus:'approved',approvedGroundTruthSha256:sha(gt),tagsReviewed:true,tags},
  {id:'case-002',sourcePath:'sources/case-002.jpg',sourceSha256:sha(data2),
    mediaType:'image/jpeg',groundTruthPath:'ground-truth/case-002.json',
    reviewStatus:'pending',tagsReviewed:false},
]}
const name=join(root,'stage.json')
const save=()=>writeFile(name,JSON.stringify(manifest))
const run=(...args)=>spawnSync(process.execPath,['tools/floorplan-gt-stage.mjs',name,...args],{encoding:'utf8'})
const bad=(expr)=>{const r=run('--check');assert.notEqual(r.status,0);assert.match(r.stderr,expr)}
try {
  await mkdir(join(root,'sources'))
  await mkdir(join(root,'ground-truth'))
  await writeFile(join(root,'sources/case-001.jpg'),data)
  await writeFile(join(root,'sources/case-002.jpg'),data2)
  await writeFile(join(root,'ground-truth/case-001.json'),gt)
  await save()
  let result=run()
  assert.equal(result.status,0,result.stderr)
  assert.equal(JSON.parse(result.stdout).approved,1)
  assert.deepEqual(JSON.parse(await readFile(join(root,'corpus-ready.json'),'utf8')).cases.map(x=>x.id),['case-001'])
  await writeFile(join(root,'ground-truth/case-002.json'),gt)
  result=run('--check')
  assert.equal(result.status,0,result.stderr)
  assert.equal(JSON.parse(result.stdout).cases[1].next,'needs_human_approval')
  await writeFile(join(root,'ground-truth/case-001.json'),gt+' ')
  bad(/须重新人工确认/)
  await writeFile(join(root,'ground-truth/case-001.json'),gt)
  manifest.cases[0].sourceSha256='f'.repeat(64);await save();bad(/SHA-256 不一致/)
  manifest.cases[0].sourceSha256=sha(data)
  manifest.cases[0].tagsReviewed=false;await save();bad(/审核标签/)
  manifest.cases[0].tagsReviewed=true
  manifest.cases[0].sourcePath='../escape.jpg';await save();bad(/相对路径/)
  manifest.cases[0].sourcePath='sources/case-001.jpg'
  manifest.cases[1].id='case-001';await save();bad(/重复/)
  manifest.cases[1].id='case-002';await save()
  manifest.cases[1].sourcePath='sources/case-001.jpg';manifest.cases[1].sourceSha256=sha(data)
  await save();bad(/同一张原图/)
  manifest.cases[1].sourcePath='sources/case-002.jpg';manifest.cases[1].sourceSha256=sha(data2);await save()
  result=run();assert.equal(result.status,0,result.stderr)
  result=run();assert.equal(result.status,0,result.stderr)
  process.stdout.write('Real GT staging smoke passed\n')
} finally { await rm(root,{force:true,recursive:true}) }
