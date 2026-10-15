import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  target: 'node22',
  // node:sqlite 只能以 node: 前缀导入，不能去掉协议前缀。
  removeNodeProtocol: false,
})
