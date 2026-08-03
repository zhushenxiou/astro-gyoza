---
title: JavaScript 垃圾回收与内存泄漏
date: 2026-07-09
summary: 深入解析 JS 引擎的引用计数与标记清除两种 GC 算法，梳理 6 种典型内存泄漏场景及解决方案，并介绍 Chrome DevTools 诊断技巧与最佳实践。
category: 技术文章
tags: [JavaScript, 垃圾回收, 内存泄漏, 性能优化]
sticky: 0
comments: false
---

## 一、垃圾回收的核心机制

要理解泄漏，先要理解回收。JS 引擎主要采用两种算法：

### 1. 引用计数（Reference Counting）

这是最简单的思路：每个对象都有一个计数器，记录有多少引用指向它。当引用数为 0 时，立即回收。

```javascript
let obj = { name: 'leak' } // 引用数 = 1
let ref = obj // 引用数 = 2
ref = null // 引用数 = 1
obj = null // 引用数 = 0 → 被回收
```

**缺陷：无法解决循环引用。**

```javascript
function createCycle() {
  let a = {}
  let b = {}
  a.child = b
  b.parent = a
  // 函数执行完，a、b 局部变量出栈，但互相引用导致引用数不为 0
  // 在引用计数算法下，它们永远无法被回收
}
```

早期 IE 的 DOM 对象就采用引用计数，因此循环引用是经典的内存泄漏元凶。不过现代浏览器早已弃用这种算法。

### 2. 标记清除（Mark-and-Sweep）—— 现代浏览器的标准

它的原理是：从**根对象**（全局对象、当前执行上下文等）出发，遍历所有可达的对象，能访问到的标记为"存活"，剩下的全部清除。

```javascript
function test() {
  let x = { data: new Array(1000000) }
  // x 是局部变量，当函数执行完毕，x 离开作用域，不再被根引用
  // 下一次 GC 时，x 被标记为不可达，内存被释放
}
test()
```

标记清除天然解决了循环引用的问题，因为只要整个环从根不可达，环中的每个对象都会被判定为垃圾。

> **注意：** GC 会暂停主线程（Stop-The-World），虽然现代引擎优化了（增量标记、并发标记），但频繁的大对象回收依然会影响性能。

---

## 二、内存泄漏的 6 种典型场景

即便有 GC，我们依然会"不经意间"留下一些根引用，导致对象无法被标记清除。下面是最常见的几种泄漏模式。

### 1. 意外的全局变量

在非严格模式下，未声明的变量会被挂到 `window` 上：

```javascript
function foo() {
  leak = 'i am global' // 等同于 window.leak
}
foo()
// leak 永远活在全局，除非手动 delete 或置 null
```

还有 `this` 指向全局的陷阱：

```javascript
function foo() {
  this.bigData = new Array(1000000)
}
foo() // this 指向 window，bigData 常驻内存
```

**解决：** 使用 `'use strict'` 避免意外全局，或者用完手动 `delete window.leak`。

### 2. 被遗忘的定时器和回调

`setInterval` / `setTimeout` 如果不清除，它们的回调函数以及函数中引用的外部变量都会一直活着。

```javascript
class Component {
  constructor() {
    this.data = new Array(1000000)
    this.timer = setInterval(() => {
      // 每次 tick 都使用 this.data
      console.log(this.data.length)
    }, 1000)
  }
  // 忘记清除定时器，组件销毁后 data 依然被 timer 回调引用
}
```

即使组件已销毁，`setInterval` 仍在运行，回调保持对 `this.data` 的引用，导致内存无法释放。

**解决：** 在组件卸载或不需要时调用 `clearInterval` / `clearTimeout`。

### 3. 闭包带来的"隐式引用"

闭包非常强大，但也容易"过度保留"父作用域中的变量。

```javascript
function createClosure() {
  let largeArr = new Array(1000000)
  return function () {
    // 虽然内部没用到 largeArr，但闭包会保留整个父级词法环境
    return 'hello'
  }
}
const fn = createClosure()
// 即使 largeArr 没被使用，它依然被闭包持有，无法回收
```

更隐蔽的情况是闭包中使用了部分变量，但整个父作用域都被保留（除非引擎做优化，但并不是所有引擎都聪明）。

**解决：** 尽量让闭包只引用必要的变量；如果确实不需要，可把大对象置为 `null`。

### 4. 被移除的 DOM 节点仍被 JavaScript 引用

这是最常见的前端泄漏。假设我们有一个按钮，我们用变量 `btn` 引用了它，之后我们移除了这个按钮，但 `btn` 依然指向那个 DOM 元素，导致它无法被回收。

```javascript
let btn = document.getElementById('myBtn')
document.body.removeChild(btn)
// 但 btn 变量仍然持有该节点，造成内存泄漏
```

更复杂的场景是 DOM 节点作为 `Map` 的 key 或对象的属性，删除 DOM 后忘记同步清理。

**解决：** 当 DOM 被移除时，记得将相关引用置为 `null`，或者使用 `WeakMap` / `WeakSet`（它们不阻止垃圾回收）。

### 5. 未解绑的事件监听器

事件监听器会隐式地持有 DOM 元素的引用（以及回调函数中引用的其他对象）。如果绑定了监听器而忘记移除，即使 DOM 被删除，监听器依然保持引用。

```javascript
function handleClick() {
  /* ... */
}
const elem = document.getElementById('some')
elem.addEventListener('click', handleClick)
// 后来移除了 elem，但忘记 removeEventListener
// handleClick 和 elem 形成引用链，导致无法回收
```

**解决：** 在移除 DOM 前，主动调用 `removeEventListener`，或者使用 `AbortController` 统一管理。

### 6. Map / Set 中的"僵尸"对象

`Map` 和 `Set` 的 key 是强引用。如果你把对象当作 key 存入 `Map`，后来该对象在业务上已经废弃，但 `Map` 仍然持有它，就会泄漏。

```javascript
let map = new Map()
let obj = { data: 'big' }
map.set(obj, 'some value')
obj = null // obj 被置空，但 map 依然持有原对象，无法回收
```

**解决：** 使用 `WeakMap` 和 `WeakSet`，它们只持有弱引用，不影响 GC。或者在不需要时 `map.delete(obj)`。

---

## 三、如何发现和诊断内存泄漏

光知道理论还不够，我们需要工具来实战。

### Chrome DevTools 的 Memory 面板

- **Heap Snapshot（堆快照）：** 拍摄前后两张快照，对比"已分配对象"的差异，找出那些应该被回收但还在的对象。

  > 步骤：先做某个操作（如打开弹窗），拍快照 1；关闭弹窗，强制 GC（点击垃圾桶图标），再拍快照 2。对比快照，查看 **Shallow Size** 和 **Retained Size** 变化。

- **Allocation instrumentation on timeline：** 录制内存分配情况，可以定位到频繁分配大对象的代码行。

- **Performance 面板的 Memory 标记：** 在录制性能时勾选 Memory，观察内存曲线是否在 GC 后依然呈上升趋势（锯齿状上升就是泄漏的信号）。

### 小技巧

- 在 Chrome 的 console 中执行 `window.gc()` 需要开启 `--expose-gc` 标志，但通常我们可以点击 DevTools 中的垃圾桶图标手动触发 GC。
- 使用 `WeakMap` 或 `WeakSet` 来"弱引用"缓存，让缓存不影响 GC。

---

## 四、最佳实践汇总

要写出一份"不泄漏"的 JS 代码，请遵守以下军规：

1. **使用 `'use strict'`** 杜绝意外全局。
2. **定时器用完必清** —— `clearInterval` / `clearTimeout` 配对使用。
3. **事件监听器在销毁时解绑** —— 尤其是在 Vue/React 的生命周期 `beforeDestroy` / `useEffect` 清理函数中。
4. **移除 DOM 节点后，断开所有 JS 引用** —— 变量置 `null`。
5. **闭包只引用必要数据** —— 如果闭包持有大对象，考虑在闭包内部用 `null` 释放。
6. **优先使用 `WeakMap` / `WeakSet`** 来存储临时关联数据，避免强引用锁死对象。
7. **定期使用 DevTools 检查内存** —— 尤其是对于单页应用（SPA），每次路由切换后检查是否有内存残留。
