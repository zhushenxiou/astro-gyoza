---
title: 发布订阅模式：手写 EventBus 事件总线
date: 2026-08-27
summary: 从发布订阅模式的核心概念出发，手写一个精简的 EventBus 事件总线，拆解 on、once、off、trigger 四个核心 API 的实现与运行流程，并总结设计要点。
category: 技术文章
tags: [JavaScript, 发布订阅, 事件总线, 设计模式]
sticky: 0
comments: false
---

## 一、什么是发布订阅模式？

发布订阅模式（Publish-Subscribe）是一种**消息解耦**的设计模式：**发布者（Publisher）** 与 **订阅者（Subscriber）** 之间不直接通信，而是通过一个中间的 **事件中心（Event Bus）** 来连接。

- **订阅（on）**：订阅者向事件中心登记，"我想听这类消息"。
- **发布（trigger）**：发布者向事件中心喊话，"这条消息广播给所有订阅者"。

好处是双方互不感知对方的存在：发布者不知道谁在听，订阅者也不知道谁在发。新增一个订阅者，无需改动发布者的任何代码——这正是它被广泛应用于 Vue 组件通信、Node.js EventEmitter、浏览器自定义事件等场景的原因。

---

## 二、手写一个 EventBus

**完整实现：**

```javascript
class EventBus {
  handlers = {}

  on(type, handler, once = false) {
    if (!this.handlers[type]) {
      this.handlers[type] = []
    }
    if (!this.handlers[type].includes(handler)) {
      this.handlers[type].push(handler)
      handler.once = once
    }
  }

  once(type, handler) {
    this.on(type, handler, true)
  }

  off(type, handler) {
    if (this.handlers[type]) {
      this.handlers[type] = this.handlers[type].filter((h) => h != handler)
    }
  }

  trigger(type) {
    if (this.handlers[type]) {
      this.handlers[type].forEach((handler) => {
        handler.call(this)

        if (handler.once) {
          this.off(type, handler)
        }
      })
    }
  }
}
```

整个结构只有两个角色：

- `handlers`：一个普通对象，以 **事件类型为 key，回调数组为 value**，是所有消息的登记表。
- 四个方法：订阅、一次性订阅、退订、发布。

---

## 三、核心 API 拆解

### 1. on —— 订阅

```javascript
on(type, handler, once = false) {
  // 该类型还没有订阅者时，先创建一个数组
  if (!this.handlers[type]) {
    this.handlers[type] = [];
  }
  // 去重：同一个回调只允许订阅一次
  if (!this.handlers[type].includes(handler)) {
    this.handlers[type].push(handler);
    handler.once = once; // 用函数属性标记是否"一次性"
  }
}
```

两个细节值得注意：

- **去重**：`includes` 保证同一事件、同一回调不会重复注册，避免重复触发。
- **用函数属性存标记**：`handler.once = once` 直接把"是否一次性"挂在函数对象上，`trigger` 里取用非常方便。

### 2. once —— 一次性订阅

```javascript
once(type, handler) {
  this.on(type, handler, true);
}
```

一个语法糖，本质是 `on` 的封装：`once = true` 的订阅者，**触发一次后自动退订**。

### 3. off —— 退订

```javascript
off(type, handler) {
  if (this.handlers[type]) {
    this.handlers[type] = this.handlers[type].filter((h) => h != handler);
  }
}
```

用 `filter` 生成一个不含该回调的新数组，替代 `splice` 手写下标删除，更简洁。这里用 `!=` 而不是 `!==`，是为了同时匹配 `undefined` 和 `null` 的宽松比较（对本例无实质影响）。

### 4. trigger —— 发布

```javascript
trigger(type) {
  if (this.handlers[type]) {
    this.handlers[type].forEach((handler) => {
      handler.call(this); // 把 EventBus 实例作为 this 传入

      if (handler.once) {
        this.off(type, handler); // 一次性订阅：触发后移除
      }
    });
  }
}
```

核心逻辑三步：**遍历回调 → 逐个执行 → 若标记 once 则立即退订**。

注意 `handler.call(this)`——回调执行时的 `this` 是 EventBus 实例本身，而非声明处的上下文。这意味着回调里可以访问 `this.on` / `this.off` 等实例方法。

---

## 四、运行流程演示

```javascript
const ev = new EventBus()

function handler1() {
  console.log('handler1')
}
function handler2() {
  console.log('handler2')
}
function handler3() {
  console.log('handler3')
}

ev.on('test', handler1)
ev.on('test', handler2)
ev.once('test', handler3)

ev.trigger('test')
ev.trigger('test')
```

**输出结果：**

```text
第一次 trigger：handler1、handler2、handler3
第二次 trigger：handler1、handler2
```

第一次触发时，handler3 执行完就被 `once` 标记移除；第二次触发只剩 handler1 和 handler2。这也验证了 `off` 的优雅之处——它不关心回调是用 `on` 还是 `once` 注册的，统一移除。

---

## 五、设计要点与不足

**这套实现体现了发布订阅的两个关键点：**

- **解耦**：发布者只调 `trigger`，订阅者只调 `on`，双方零耦合。
- **事件为中心**：一切通信都以事件类型为纽带，新增事件类型只需注册新的 key。

**作为学习示例，它也有几处简化，可自行扩展：**

1. **不支持传参**：`trigger(type)` 只广播事件类型，不携带数据。可改为 `trigger(type, ...args)`，并在调用时 `handler.call(this, ...args)`，这是 EventEmitter 的标配能力。
2. **函数属性有隐患**：`handler.once` 会永久修改函数对象本身，若同一函数在另一处被 `on` 注册，其 `once` 标记会残留。更稳妥的做法是把标记放进一个包装对象里。
3. **同名回调去重是双刃剑**：若同一声明处需要注册两个相同引用的回调，会被静默忽略。

发布订阅模式是前端最常被问到的设计模式之一，手写一遍 EventBus，比背概念更能理解它的本质。
