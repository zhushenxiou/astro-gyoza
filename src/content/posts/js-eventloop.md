---
title: JavaScript 事件循环与异步编程
date: 2026-07-01
summary: 从一道经典面试题出发，手撕 JavaScript 事件循环执行流程，深入解析同步代码、微任务、宏任务与 requestIdleCallback 空闲回调的调度时机，以及 async/await 与 Promise 的常见陷阱。
category: 技术文章
tags: [JavaScript, 事件循环, 异步编程]
sticky: 0
comments: false
---

## 一、经典面试题（实战自测）

```javascript
console.log(1)
setTimeout(() => console.log(2), 1)
new Promise(() => {}).then(() => console.log(3))
async function fn() {
  console.log(4)
  await null
  console.log(5)
}
fn()
console.log(6)
```

### 正确答案

**输出顺序：1 → 4 → 6 → 5 → 2**

（注：3 永远不会被打印）

---

## 二、核心前置知识（必背基石）

### 1. 事件循环（Event Loop）执行铁律

- **同步代码优先**：先执行调用栈（Call Stack）中的全部同步任务。
- **微任务插队**：同步代码执行完毕后，**立即清空微任务队列（Microtask Queue）**，且清空过程中新增的微任务也会在当前轮次被连带执行。
- **宏任务轮询**：微任务队列清空后，浏览器可能执行渲染，然后从宏任务队列（MacroTask Queue）中**取出一个**宏任务执行，执行完后再立即清空微任务，如此往复。

### 2. 任务队列优先级

| 类型         | 常见 API                                                                             | 优先级                       |
| ------------ | ------------------------------------------------------------------------------------ | ---------------------------- |
| **同步代码** | console.log、for 循环、函数声明                                                      | **最高（立即执行）**         |
| **微任务**   | Promise.then/catch/finally、async/await 之后的代码、MutationObserver、queueMicrotask | **次高（同步清空后执行）**   |
| **宏任务**   | setTimeout、setInterval、I/O 事件、setImmediate（Node）                              | **最低（每次只取一个）**     |
| **空闲任务** | requestIdleCallback                                                                  | **最低（渲染后空闲时执行）** |

### 3. async/await 的本质（极其重要）

- **async 函数被调用时，函数体内的同步代码会立即执行**，直到遇到第一个 await 或 return 才会让出主线程。
- await 会将**后续代码**（紧跟 await 之后的语句）**强制封装为一个微任务**，塞进微任务队列。

### 4. Promise 构造器的陷阱

- `new Promise((resolve, reject) => { ... })` 中的执行器函数是**同步执行**的。
- 如果执行器内部没有调用 `resolve()` 或 `reject()`，该 Promise 将**永远处于 Pending（待定）状态**，其 `.then()` 回调**永远不会被注册进微任务队列**。

### 5. requestIdleCallback 的执行时机（划重点）

`requestIdleCallback(cb)` 的回调**不进宏任务队列**，而是利用浏览器**每一帧内的空闲时间**执行，优先级低于宏任务：

- **执行位置**：一帧的完整顺序是 `宏任务 → 微任务 → 渲染`，渲染完成后若帧预算（60fps 下约 16.7ms）仍有剩余，就进入**空闲期**执行 idle 回调。
- **回调参数 `deadline`**：`deadline.timeRemaining()` 返回当前空闲期的剩余毫秒数，常用于把长任务**分片**到多个空闲期逐步完成，避免阻塞渲染。
- **不保证执行**：若主线程一直满载（始终无空闲期），idle 回调可能**永远不被触发**。
- **`timeout` 兜底**：`requestIdleCallback(cb, { timeout: 2000 })` 即使始终无空闲，也保证在 2s 内强制执行。
- **与 requestAnimationFrame 对比**：rAF 在**渲染前**执行（配合刷新率更新画面），requestIdleCallback 在**渲染后空闲时**执行（做低优先级补充工作）。

---

## 三、逐行执行全流程拆解（手撕事件循环）

把"一"中的代码按事件循环三阶段完整走一遍：

### ① 同步阶段（执行 Script 宏任务）

| 代码行                                             | 动作                                                                        | 输出/状态                   |
| -------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------- |
| `console.log(1)`                                   | 直接压栈执行                                                                | 打印 `1`                    |
| `setTimeout(() => console.log(2), 1)`              | 交给定时器模块，1ms 后回调进入**宏任务队列**                                | 入队等待                    |
| `new Promise(() => {}).then(() => console.log(3))` | 执行器未调用 resolve，Promise 永远 pending                                  | `.then` 作废，`3` 永不打印  |
| `fn()`                                             | 同步执行到 await 前：打印 `4`；`await null` 将打印 `5` 封装为**微任务**入队 | 打印 `4`；微任务队列：`[5]` |
| `console.log(6)`                                   | 同步执行                                                                    | 打印 `6`                    |

**此阶段输出：`1 → 4 → 6`**

### ② 微任务阶段（Microtask Checkpoint）

同步代码结束后立即清空微任务队列：执行 await 留下的 `console.log(5)` → 打印 `5`。

### ③ 宏任务阶段

主线程空闲，取出宏任务队列中的 setTimeout 回调 → 打印 `2`。

**最终输出：`1 → 4 → 6 → 5 → 2`**

---

## 四、常见误区与高频追问（防坑指南）

### 误区 1："异步函数整体是异步的，所以 4 应该在 6 后面。"

**正解**：async 函数中的代码只有遇到 await 之后的部分才异步。await **之前**的代码（如 `console.log(4)`）属于同步执行，必然在调用栈返回主线程（`console.log(6)`）之前执行。

### 误区 2："await null 会报错或者堵塞线程。"

**正解**：await 后面如果不是 Promise，会通过 `Promise.resolve()` 将其包裹为已解决的 Promise，后续代码依然会作为微任务正常入队，不会阻塞主线程。

### 误区 3："new Promise 不 resolve，那 then 只是延迟执行。"

**正解**：不 resolve 意味着状态永远不改变，`.then` 回调根本没有机会被加入微任务队列（见核心知识 4），相当于这段逻辑被彻底"抛弃"了。

---

## 五、变式题（举一反三）

**追问**：如果把 `new Promise(() => {})` 改成 `new Promise((resolve) => resolve())`，输出变成什么？

**答案**：1 → 4 → 6 → 3 → 5 → 2

**原理**：`resolve()` 后，`console.log(3)` 立即作为微任务入队，且微任务队列清空时，3 排在 await 产生的 5 之前（先入先出），但两者均早于宏任务 2。

---

## 六、总结速记口诀（面试背诵版）

> **"同步先跑，微任务清空，宏任务最后捞；async 同步跑到 await，后续代码变微包；Promise 不 resolve，.then 直接人间蒸发；渲染后空闲，requestIdleCallback 来兜底。"**
