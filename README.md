# 每日食谱记录 H5

一个本地优先的 H5 饮食记录应用，用于记录每日餐食、体重、热量缺口，并接入 DeepSeek `deepseek-v4-flash` 做热量估算和饮食建议。

## 运行

推荐使用本地代理，避免把 API Key 暴露在浏览器：

```powershell
$env:DEEPSEEK_API_KEY="你的 DeepSeek API Key"
node server.js
```

然后打开：

```text
http://localhost:5173
```

如果只是查看界面，也可以直接打开 `index.html`。DeepSeek 分析功能在直接打开文件时需要切换到“浏览器直连”并填写 API Key；该方式只适合个人本地测试。

## 功能

- 初始化身高、体重、年龄、性别、活动水平、增肌 / 减脂 / 维持目标。
- 记录每日餐食、热量、蛋白质、碳水和脂肪。
- 自动计算基础代谢、维持热量、目标摄入、每日 / 每周 / 每月热量缺口。
- 记录体重变化，并绘制热量缺口和体重趋势。
- 使用 DeepSeek `deepseek-v4-flash` 估算餐食热量、分析当日饮食、生成明日食谱和一周策略。
- 本地浏览器持久化，支持 JSON 导入导出。

## API 说明

默认使用 DeepSeek 官方 OpenAI 兼容接口：

```text
POST https://api.deepseek.com/chat/completions
model: deepseek-v4-flash
```

本地代理接口：

```text
POST /api/deepseek/chat
```

代理会从环境变量 `DEEPSEEK_API_KEY` 读取密钥，并把请求转发给 DeepSeek。

## Windows release

生成可解压使用的 Windows 软件包：

```powershell
.\build-release.ps1
```

脚本会生成：

```text
release\DailyNutritionLedger-win-x64\
release\DailyNutritionLedger-win-x64.zip
```

发布时请上传 zip，用户解压后双击 `DailyNutritionLedger.exe` 即可启动。不要只发布单个 exe，因为软件还需要内置的 Node.js 运行时、`server.js` 和网页资源文件。
