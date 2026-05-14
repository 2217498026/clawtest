---
name: tauri-macos-ats-exception
overview: 在 tauri.conf.json 的 bundle 中添加 macOS Info.plist 配置，允许所有 HTTP 连接（NSAppTransportSecurity），修复 macOS 上远程 HTTP 服务器无法连接的问题。
todos:
  - id: add-macos-bundle-config
    content: 在 src-tauri/tauri.conf.json 的 bundle 中添加 macOS.infoPlist 配置，允许所有 HTTP 连接
    status: completed
---

在 `src-tauri/tauri.conf.json` 的 `bundle` 中添加 macOS 配置，通过 `NSAppTransportSecurity.NSAllowsArbitraryLoads` 允许所有 HTTP 连接，解决 macOS 上 WKWebView 的 App Transport Security (ATS) 阻止 HTTP 远程请求的问题。

## 实现方案

### 修改目标

`src-tauri/tauri.conf.json` 第 54 行，在 `bundle` 的 `windows` 块之后，`bundle` 闭合之前，添加 `macOS` 配置块。

### 具体改动

在 `tauri.conf.json` 的 `bundle` 对象中，`windows` 块之后新增：

```
"macOS": {
  "infoPlist": {
    "NSAppTransportSecurity": {
      "NSAllowsArbitraryLoads": true
    }
  }
}
```

### 原理说明

- Tauri v2 在 macOS 上使用 WKWebView 渲染前端，默认启用 ATS，阻止所有 HTTP（非 HTTPS）请求
- `bundle.macOS.infoPlist` 是 Tauri v2 的标准配置方式，构建时会自动写入 macOS 应用包的 Info.plist
- 该设置仅影响 macOS 平台，对 Windows/Linux 无影响
- 与现有的 `windows` 配置块平级，互不干扰

### 目录结构

```
src-tauri/tauri.conf.json  # [MODIFY] 在 bundle 中新增 macOS 配置块，添加 NSAllowsArbitraryLoads
```