# Android 构建

保留 Capacitor Android 项目、返回键处理、安全区适配、原生 JSON 备份分享与启动资源。需要 Node.js 22.12+、JDK 21、Android SDK Platform 36，以及可下载 Gradle/Android 依赖的网络。

```bash
npm ci
# JAVA_HOME 指向你自己的 JDK 21；Android SDK 路径由 Android Studio 或本机 local.properties 配置。
npm run android:build
```

输出：`android/app/build/outputs/apk/debug/app-debug.apk`。`cap:sync` 会生成 Capacitor Android 插件目录和 Web 资源，这些属于运行产物，不进入 Skill 模板。

模板包名为 `com.example.contentmanager`。自用测试可以沿用，正式发布前将 `capacitor.config.ts`、`android/app/build.gradle`、`strings.xml`、Java 源/测试包名及目录同步改为自己的唯一 ID。更换包名后系统视为另一个应用，不能继承旧私有包名下的数据；先从旧应用导出 JSON，再在新应用导入。

模板不带签名密钥、SDK 路径或生产签名配置。Debug APK 仅用于调试，应用商店发布请用自己的签名与发布流程。需要离线保留原字体时，先按 `fonts.md` 装入自己取得的字体，再构建。
