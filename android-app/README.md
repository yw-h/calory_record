# 每日食谱记录 Android

这是一个 Android Studio 可打开的原生 WebView 版本，内置当前 H5 页面，适合手机端日常记录。

## 打包

1. 用 Android Studio 打开 `android-app` 目录。
2. 等待 Gradle 同步。
3. 连接安卓手机，点击 Run，或使用 Build APK 生成安装包。

当前机器没有检测到 Android SDK / Gradle，因此没有在本地生成 APK；项目结构已经按 Android Gradle Plugin 8.5 配好。

## 手机端特性

- 页面从 `app/src/main/assets/index.html` 加载，不依赖电脑端 localhost。
- 本地记录继续使用浏览器存储。
- 云同步通过 Android 原生桥发起 WebDAV 请求，不需要手机端运行 `node server.js`。
- DeepSeek 在 Android 端通过原生桥请求；应用会自动切到直连模式，请在设置里填写 API Key。
- 手机端样式增加底部导航、紧凑卡片和触控友好表单。

## 同步 H5 改动

如果以后继续修改电脑端 `index.html`、`app.js`、`styles.css`，需要同步复制到：

```text
android-app/app/src/main/assets/
```

安卓专属的移动端覆盖样式在 assets 版 `styles.css` 文件末尾。
