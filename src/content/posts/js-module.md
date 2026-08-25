---
title: JavaScript 模块化
date: 2026-08-25
summary: 从模块化的定义与核心价值出发，系统对比 CommonJS 与 ES Module 两大主流规范，深度拆解运行时加载 vs 编译时加载、值拷贝 vs 动态引用等核心机制，并梳理 Tree Shaking 原理、模块缓存、Node.js 混合使用规则、浏览器端 ESM 与高频面试追问。
category: 技术文章
tags: [JavaScript, 模块化, CommonJS, ES Module, Tree Shaking]
sticky: 0
comments: false
---

## 一、什么是模块化？

**定义：** 将程序按功能拆分成独立、可复用的小文件（模块），每个模块拥有独立作用域。

**核心价值：**

- 解决全局命名冲突
- 管理依赖关系
- 提高可维护性和复用性

**本质：** 模块对外暴露接口（export），隐藏内部实现（private），其他模块通过导入（import）使用。

---

## 二、主流规范对比：CommonJS vs ES Module

| 对比维度 | CommonJS                                               | ES Module（ESM）                                |
| -------- | ------------------------------------------------------ | ----------------------------------------------- |
| 语法     | `const x = require('xxx');`<br/>`module.exports = {};` | `import x from 'xxx';`<br/>`export default {};` |
| 加载时机 | **运行时加载**（执行到 require 才读取文件）            | **编译时加载**（静态分析阶段就确定依赖关系）    |
| 输出方式 | **值的拷贝**（导出值的快照）                           | **动态引用**（只读映射，指向同一内存地址）      |
| 执行环境 | Node.js（默认）                                        | 浏览器 + Node.js（需开启支持）                  |
| 条件导入 | ✅ 支持（可写在 `if` 里）                              | ❌ 不支持（`import` 必须在顶层）                |
| 文件扩展 | `.js`、`.cjs`                                          | `.js`（需 `"type": "module"`）、`.mjs`          |

---

## 三、核心机制深度拆解

### 1. 加载时机：运行时 vs 编译时

**CommonJS（运行时）**

```javascript
// a.js
console.log('a 执行')
module.exports = { name: 'A' }

// main.js
console.log('main 开始')
const a = require('./a') // 执行到这一行才加载 a.js
console.log(a.name)

// 输出顺序：main 开始 → a 执行 → A
```

**ES Module（编译时）**

```javascript
// a.js
console.log('a 执行')
export const name = 'A'

// main.js
import { name } from './a' // 代码执行前，引擎先扫描所有 import，提升到顶部
console.log('main 开始')
console.log(name)

// 输出顺序：a 执行 → main 开始 → A
// 注意：import 会被提升，不能写在 if 或函数里
```

### 2. 输出方式：值拷贝 vs 动态引用（高频面试点）

**CommonJS —— 值的拷贝**

```javascript
// counter.js
let count = 1
function increment() {
  count++
}
module.exports = { count, increment }

// main.js
const { count, increment } = require('./counter')
console.log(count) // 1
increment()
console.log(count) // 还是 1（因为 count 是原始值的拷贝，内部变化不影响外部）
```

**ES Module —— 动态引用**

```javascript
// counter.js
export let count = 1
export function increment() {
  count++
}

// main.js
import { count, increment } from './counter'
console.log(count) // 1
increment()
console.log(count) // 2（import 是只读引用，指向同一个地址，实时反映变化）
```

> **补充：导入的绑定是只读的。** ESM 的导入是「只读映射」，可以读取、调用，但**不能重新赋值**——对导入的绑定赋值会直接抛 `TypeError`。想修改只能通过模块内部暴露的函数。

### 3. 导出方式详解

**CommonJS 导出**

```javascript
// 方式1：逐个导出
exports.name = 'A'
exports.age = 18

// 方式2：整体导出（覆盖上面）
module.exports = { name: 'A', age: 18 }

// 注意：exports 是 module.exports 的引用，最终以 module.exports 为准
```

**ES Module 导出**

```javascript
// 方式1：命名导出（可多个）
export const name = 'A'
export function sayHi() {}

// 方式2：默认导出（只能一个）
export default { name: 'A', age: 18 }

// 方式3：混合导出
export const name = 'A'
export default function () {}

// 导入方式对应
import defaultFunc, { name } from './module'
```

**高级写法（工程/面试常用）：**

```javascript
// 重命名导出 / 导入
export { name as aliasName }
import { aliasName as name } from './module'

// 命名空间导入（整体导入）
import * as ns from './module'
ns.name // 访问其所有命名导出

// 透传导出（barrel 文件，集中管理出口）
// lib/index.js
export { a } from './a'
export { b } from './b'
```

> **注意：** `import * as ns` 拿到的同样是一个**只读**命名空间对象，不能对其属性赋值。

---

## 四、Tree Shaking（摇树优化）—— ESM 的独家优势

### 1. 什么是 Tree Shaking？

**定义：** 打包工具（Webpack、Vite）在打包时，移除未被引用的死代码（Dead Code），减小最终文件体积。

### 2. 为什么只有 ESM 能做到？

| 规范      | 是否支持 Tree Shaking | 原因                                                                                                                         |
| --------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| CommonJS  | ❌ 不支持             | `require` 的路径可以是变量或表达式（如 `require(flag ? 'a' : 'b')`），打包工具在编译时无法确定哪些导出被使用，只能全量打包。 |
| ES Module | ✅ 支持               | `import`/`export` 必须是静态声明（路径固定，无变量），打包工具在编译时能精确分析依赖图谱，标记并删除未使用的导出。           |

### 3. 示例

```javascript
// math.js
export const add = (a, b) => a + b
export const multiply = (a, b) => a * b // 未被引用

// main.js
import { add } from './math'
console.log(add(1, 2))

// 打包后，multiply 函数会被自动删除 ✅
```

### 4. Tree Shaking 的边界：sideEffects

Tree Shaking 只敢删除「纯函数式、无副作用」的未用代码。若模块顶层代码有副作用（如修改全局属性、`console.log`、改动原型），打包工具无法确定删除后是否安全，只能保留。

```json
// package.json
{
  "sideEffects": false // 声明本包所有模块均无副作用，可放心摇树
  // 也可声明白名单："sideEffects": ["*.css"]
}
```

> **面试点：** `lodash` 等库能被摇树，依赖的正是库作者声明了 `sideEffects: false`；UI 组件库里的样式导入（如 `import 'xxx.css'`）则必须写进白名单，否则会被误删。

---

## 五、Node.js 中的混合使用规则

| 文件类型 | 模块规范         | 说明                                              |
| -------- | ---------------- | ------------------------------------------------- |
| `.js`    | CommonJS（默认） | 若 package.json 中 `"type": "module"`，则变为 ESM |
| `.mjs`   | ES Module        | 强制 ESM                                          |
| `.cjs`   | CommonJS         | 强制 CommonJS                                     |

**跨规范导入限制：**

- ESM 可以 `import` CommonJS 模块（兼容处理）
- CommonJS 不能 `require` ESM 模块（ESM 是异步加载的）
- ESM 中不能使用 `__dirname`、`__filename`、`require` 等 CommonJS 全局变量（需用 `import.meta.url` 替代）

### 2. CommonJS 的模块缓存（高频）

`require` 自带缓存：**同一个模块多次 require，只执行一次，后续都返回缓存中的同一个对象**（单例）。

```javascript
// counter.js
console.log('模块只执行一次')
module.exports = { count: 1 }

// main.js
const a = require('./counter') // 输出：模块只执行一次
const b = require('./counter') // 无输出（命中缓存）
console.log(a === b) // true，同一实例
```

如需强制重新加载：`delete require.cache[require.resolve('./counter')]`（热更新常用）。

### 3. 模块包装函数（`__dirname`/`__filename` 的来源）

CommonJS 模块在执行前，会被 Node 包装进一个函数：

```javascript
;(function (exports, require, module, __filename, __dirname) {
  // 你的模块代码
})
```

由此可推出几个结论：

- `__dirname`、`__filename` 是**包装函数的参数**，并非全局变量。
- `exports`、`module`、`require` 同样是参数，模块内的变量因此不会污染全局。
- ESM 没有这层包装，所以没有 `__dirname`/`__filename`，只能通过 `import.meta.url` 自行解析——这正是上一条限制的根本原因。

---

## 六、浏览器端的 ES Module

浏览器通过 `<script type="module">` 原生加载 ESM，它与普通 `<script>` 有本质区别：

| 对比点    | 普通 `<script>`                   | `<script type="module">`                        |
| --------- | --------------------------------- | ----------------------------------------------- |
| 加载时机  | 默认同步阻塞（暂停解析）          | **默认 defer**（不阻塞渲染，HTML 解析完再执行） |
| 严格模式  | 非严格模式                        | **自动启用严格模式**                            |
| 作用域    | 全局作用域（`var` 会挂到 window） | **模块作用域**（顶层变量不污染全局）            |
| 顶层 this | `window`                          | **`undefined`**                                 |
| 跨域加载  | 无限制                            | **受 CORS 限制**（跨域需正确 CORS 头）          |
| 循环依赖  | 不支持                            | 原生支持                                        |

**兼容性回退：** 老浏览器不认识 `type="module"`，可通过 `nomodule` 加载降级脚本：

```html
<script type="module" src="main.js"></script>
<script nomodule src="legacy.js"></script>
<!-- 支持 ESM 的浏览器只执行第一个，老浏览器只执行第二个 -->
```

> **小结：** 「默认 defer + 自动严格模式 + 模块作用域」三大特性，加上支持 Tree Shaking，正是浏览器端 ESM 取代传统 script 方案与 AMD 的根本原因。

---

## 七、其他模块化规范（了解即可）

| 规范             | 环境                  | 特点                                           |
| ---------------- | --------------------- | ---------------------------------------------- |
| AMD（RequireJS） | 浏览器                | 异步加载，依赖前置                             |
| CMD（SeaJS）     | 浏览器                | 异步加载，依赖就近（延迟执行）                 |
| UMD              | 通用（浏览器 + Node） | 兼容 AMD + CommonJS + 全局变量，用于通用库打包 |

> **现状：** AMD/CMD/UMD 基本被 ESM 和 CommonJS 取代，仅老旧项目或兼容库中使用。

---

## 八、终极速记口诀

- **CommonJS：** 运行时加载、值拷贝、动态灵活、Node 默认、不能摇树、require 自带缓存。
- **ES Module：** 编译时加载、动态引用、静态声明、浏览器 + Node、支持摇树、导入绑定只读。
- **Tree Shaking 依赖 ESM：** 因为静态结构让工具在编译时就能判断死代码。

---

## 九、高频面试追问清单

1. **CommonJS 的 require 是同步还是异步？**
   → 同步（所以不适合浏览器，阻塞 UI）。

2. **ESM 是异步加载吗？**
   → 浏览器中 `import` 会触发异步加载，Node 中默认同步，但也支持异步 `import()` 动态导入。

3. **`import()` 动态导入是什么规范？**
   → 是 ESM 的补充，返回 Promise，支持条件加载（可以写在 `if` 里），且支持 Tree Shaking。

4. **循环依赖在两种规范中怎么处理？**
   → CommonJS 输出已执行部分的拷贝（可能不完整）；ESM 因动态引用，需依赖加载器的具体实现（通常只读引用，最终都能取到）。

5. **Webpack 的 `require.ensure` 和 `import()` 区别？**
   → 前者是 Webpack 特有 API，后者是标准 ESM 动态导入，推荐 `import()`。

6. **CommonJS 的 require 缓存机制是怎样的？**
   → 同一个模块首次加载后会被缓存，后续 require 直接返回同一实例（单例）；可用 `delete require.cache[require.resolve('./x')]` 强制重载，常用于热更新。

7. **为什么 ESM 导入的绑定不能重新赋值？**
   → 导入是「只读映射」，指向模块内部的同一内存地址。规范规定对导入绑定赋值会抛 `TypeError`，防止外部意外修改模块内部状态。

8. **`<script type="module">` 和普通 `<script>` 有什么区别？**
   → 默认 defer、自动严格模式、模块作用域、顶层 this 为 `undefined`、跨域受 CORS 限制。

9. **package.json 里的 `sideEffects` 字段有什么用？**
   → 声明本包模块是否含副作用。设为 `false` 时，打包工具可安全摇树删除未使用代码；样式等有副作用的导入需在白名单中保留。
