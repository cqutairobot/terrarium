# 浮生 · Tiny Eden

一个会自己演化的微观生态缸。打开网页，就像在屏幕里养了一整个小宇宙。

> 开发中：按阶段实现，详见提交历史。

## 运行

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 类型检查 + 生产构建（输出到 dist/）
npm run preview    # 预览构建结果
npm test           # 单元测试
npm run sim -- --seed eden --hours 2   # 无头长时模拟（调参/验证用）
```

URL 参数 `?seed=任意文字` 可以用指定种子创建世界。
