---
title: Vue 2 与 Vue 3 响应式原理深度解析
date: 2026-08-04
summary: 从 Object.defineProperty 到 Proxy，手写简化版响应式实现，深入解析依赖收集、派发更新的核心机制，对比两个版本的差异与优劣。
category: 技术文章
tags: [Vue, JavaScript, 响应式原理, 前端框架]
sticky: 0
comments: false
---

## 前言

从 Vue 2 到 Vue 3，响应式系统经历了一次彻底的重构：从 `Object.defineProperty` 到 `Proxy`。这不仅是 API 的更换，更是设计理念与能力的全面升级。

用一句话来总结响应式的核心就是：**在 getter 中收集依赖，在 setter 中触发依赖。** 无论是 Vue 2 还是 Vue 3，这句话始终成立。

今天我们就来手撕这套机制，彻底搞懂 Vue 的响应式到底是怎么工作的。

---

## 一、Vue 2 的响应式原理：Object.defineProperty

### 1. 核心机制

Vue 2 的响应式建立在 ES5 的 `Object.defineProperty()` 之上。当你把一个普通 JavaScript 对象传入 Vue 实例的 `data` 选项时，Vue 会遍历这个对象的所有属性，将它们全部转换为 getter/setter。

**简化版实现：**

```javascript
function defineReactive(obj, key, val) {
  // 递归处理子对象——这是 Vue 2 初始化时"递归劫持"的根源
  observe(val)

  // 每个响应式属性都有一个专属的依赖收集器
  const dep = new Dep()

  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    get: function reactiveGetter() {
      // 依赖收集：谁在用我，我就记住谁
      if (Dep.target) {
        dep.depend()
      }
      return val
    },
    set: function reactiveSetter(newVal) {
      if (newVal === val) return
      // 新值可能是对象，也要递归处理
      observe(newVal)
      val = newVal
      // 派发更新：我变了，通知所有依赖我的人
      dep.notify()
    },
  })
}
```

**依赖收集器（Dep）与观察者（Watcher）：**

```javascript
class Dep {
  constructor() {
    this.subscribers = new Set() // 存储所有依赖（Watcher）
  }
  depend() {
    if (Dep.target) {
      this.subscribers.add(Dep.target)
    }
  }
  notify() {
    this.subscribers.forEach((sub) => sub.update())
  }
}

// 全局的"当前正在执行的 Watcher"
Dep.target = null

class Watcher {
  constructor(vm, expOrFn, cb) {
    this.vm = vm
    this.cb = cb
    this.getter = expOrFn
    this.value = this.get() // 实例化时触发 getter，完成依赖收集
  }
  get() {
    Dep.target = this // 把"自己"挂到全局
    const value = this.getter.call(this.vm) // 访问响应式数据 → 触发 getter → dep.depend()
    Dep.target = null // 收集完毕，复位
    return value
  }
  update() {
    const newVal = this.get()
    this.cb(newVal) // 执行回调，更新视图
  }
}
```

整个过程就像一个精心设计的"订阅-发布"系统：每个响应式属性（`data` 中的属性）都有一个专属的"通知列表"（Dep），当组件渲染时，用到的属性会在 getter 中把组件的 Watcher 加入列表；当属性被修改时，setter 遍历列表，通知所有 Watcher 更新。

### 2. Vue 2 响应式的三个局限

`Object.defineProperty` 在当时是合理的选择，但它有几个先天不足。

**① 无法监听数组索引的变化**

`Object.defineProperty` 理论上可以劫持数组索引，但 Vue 2 选择不这么做——性能代价太大。Vue 2 的解决方案是重写数组的七个原型方法（`push`、`pop`、`shift`、`unshift`、`splice`、`sort`、`reverse`），在这些方法被调用时手动触发更新。

```javascript
// 直接通过索引修改数组 —— 不会触发更新 ❌
this.list[0] = 'new value'

// 必须使用 Vue 提供的数组方法 ✅
this.list.splice(0, 1, 'new value')
// 或者使用 Vue.set
Vue.set(this.list, 0, 'new value')
```

**② 无法检测对象属性的新增或删除**

`Object.defineProperty` 只能劫持**已经存在**的属性。如果你在实例创建之后新增或删除属性，Vue 完全感知不到。

```javascript
// 直接新增属性 —— 不会触发更新 ❌
this.obj.newProp = 'hello'

// 必须使用 Vue.set ✅
Vue.set(this.obj, 'newProp', 'hello')

// 删除属性同样需要 Vue.delete
Vue.delete(this.obj, 'oldProp')
```

**③ 递归遍历的性能开销**

为了让深层嵌套的对象也变成响应式，Vue 2 在初始化时必须递归遍历 `data` 的每一个属性。如果一个对象嵌套层级很深（比如一棵大型树结构），初始化时的性能开销会相当可观——即使这些深层属性可能永远不会被用到。

```javascript
const vm = new Vue({
  data: {
    level1: {
      level2: {
        level3: {
          // ... 嵌套 10 层
          deepProp: 'value', // Vue 2 初始化时就会递归到这，全部劫持
        },
      },
    },
  },
})
```

---

## 二、Vue 3 的响应式原理：Proxy

### 1. 为什么选择 Proxy？

Vue 3 引入了 ES6 的 `Proxy` 来替代 `Object.defineProperty`。Proxy 的核心优势在于：它可以**代理整个对象**，拦截对对象的所有操作，而不仅仅是某个属性。

```javascript
const handler = {
  get(target, key, receiver) {
    console.log(`读取属性: ${String(key)}`)
    return Reflect.get(target, key, receiver)
  },
  set(target, key, value, receiver) {
    console.log(`设置属性: ${String(key)} = ${value}`)
    return Reflect.set(target, key, value, receiver)
  },
  deleteProperty(target, key) {
    console.log(`删除属性: ${String(key)}`)
    return Reflect.deleteProperty(target, key)
  },
}

const obj = new Proxy({ name: 'Vue' }, handler)
obj.name // 读取属性: name
obj.age = 3 // 设置属性: age = 3
delete obj.name // 删除属性: name
```

一次 Proxy 代理，覆盖了读取、写入、删除、`in` 操作符、`Object.keys` 等所有操作——这是 `Object.defineProperty` 逐个属性劫持完全无法比拟的。

### 2. reactive 的实现原理

Vue 3 的 `reactive` API 底层就是通过 Proxy 实现的。与 Vue 2 的"初始化时递归劫持"不同，Vue 3 采用的是**惰性代理**——只有当访问到某个属性，且该属性是对象时，才将它转换为响应式。

**简化版实现：**

```javascript
// 全局的依赖存储：target → key → Set<effect>
const targetMap = new WeakMap()
let activeEffect = null // 当前正在执行的 effect

function reactive(target) {
  // 非对象直接返回
  if (typeof target !== 'object' || target === null) {
    return target
  }

  return new Proxy(target, {
    get(target, key, receiver) {
      const res = Reflect.get(target, key, receiver)
      // 依赖收集
      track(target, key)
      // 惰性代理：访问到子对象时才递归包装
      return typeof res === 'object' && res !== null ? reactive(res) : res
    },
    set(target, key, value, receiver) {
      const oldValue = target[key]
      const result = Reflect.set(target, key, value, receiver)
      // 值实际发生变化时才触发更新
      if (oldValue !== value) {
        trigger(target, key)
      }
      return result
    },
    deleteProperty(target, key) {
      const hadKey = Object.prototype.hasOwnProperty.call(target, key)
      const result = Reflect.deleteProperty(target, key)
      // 确实删除了一个已有属性时触发更新
      if (hadKey && result) {
        trigger(target, key)
      }
      return result
    },
  })
}

// 依赖收集
function track(target, key) {
  if (!activeEffect) return // 没有正在执行的 effect，无需收集
  let depsMap = targetMap.get(target)
  if (!depsMap) {
    targetMap.set(target, (depsMap = new Map()))
  }
  let dep = depsMap.get(key)
  if (!dep) {
    depsMap.set(key, (dep = new Set()))
  }
  dep.add(activeEffect)
}

// 派发更新
function trigger(target, key) {
  const depsMap = targetMap.get(target)
  if (!depsMap) return
  const dep = depsMap.get(key)
  if (dep) {
    dep.forEach((effect) => effect())
  }
}
```

Vue 3 依赖收集的数据结构是 `WeakMap<target, Map<key, Set<effect>>>`——这与 Vue 2 的"每个属性一个 Dep 实例"在思路上一致，但粒度更细，且利用了 `WeakMap` 的特性：当 target 不再被引用时，整个依赖图谱会自动被 GC 清理。

### 3. ref 的本质

`ref` 是 Vue 3 处理基本数据类型（string、number、boolean 等）响应式的方式。基本类型不是对象，不能被 Proxy 代理，所以 `ref` 的做法是把它包进一个对象，然后劫持 `.value` 属性。

**简化版实现：**

```javascript
class RefImpl {
  constructor(value) {
    this._value = value
    this.__v_isRef = true // 标记为 ref，供模板自动解包
  }
  get value() {
    track(this, 'value') // 收集依赖
    return this._value
  }
  set value(newVal) {
    if (newVal !== this._value) {
      this._value = newVal
      trigger(this, 'value') // 触发更新
    }
  }
}

function ref(value) {
  // 如果已经是 ref，直接返回；否则创建 RefImpl
  return isRef(value) ? value : new RefImpl(value)
}
```

**模板中的自动解包：** Vue 3 的模板编译器会识别 `ref` 对象，在模板中访问时自动"拆开"一层 `.value`，所以你在模板中写 `{{ count }}` 而不是 `{{ count.value }}`。但在 JavaScript 代码中，必须通过 `.value` 来读写。

---

## 三、Vue 2 vs Vue 3 核心对比

| 对比维度                  | Vue 2 (Object.defineProperty) | Vue 3 (Proxy)                 |
| ------------------------- | ----------------------------- | ----------------------------- |
| 监听对象新增属性          | ❌ 不支持，需 `Vue.set`       | ✅ 自动监听                   |
| 监听对象删除属性          | ❌ 不支持，需 `Vue.delete`    | ✅ 自动监听                   |
| 监听数组索引 `arr[0] = x` | ❌ 不支持                     | ✅ 原生支持                   |
| 监听数组 `length` 变化    | ❌ 不支持                     | ✅ 原生支持                   |
| 监听数组方法 `push/pop`   | ⚠️ 需重写原型方法             | ✅ 原生支持                   |
| 初始化性能                | 递归遍历所有属性，开销大      | 惰性代理，按需转换            |
| 内存占用                  | 每个属性一个 Dep 实例         | 按 key 维度，WeakMap 自动清理 |
| 浏览器兼容                | 较好（支持 IE9+）             | 无法 polyfill，不支持 IE11    |
| 代理层级                  | 属性级别                      | 对象级别                      |

**代码表现对比：**

```javascript
// ===== Vue 2 =====
const vm = new Vue({
  data: { count: 0, list: [1, 2, 3], obj: { a: 1 } },
})

vm.count = 10 // ✅ 触发更新（已有属性的 setter）
vm.newProp = 'hello' // ❌ 不触发更新（新增属性，无法感知）
vm.list[0] = 100 // ❌ 不触发更新（索引赋值，未劫持）
vm.list.push(4) // ✅ 触发更新（重写了 push 方法）
vm.obj.a = 2 // ✅ 触发更新（嵌套对象已被递归劫持）
delete vm.obj.a // ❌ 不触发更新（删除属性，无法感知）

// ===== Vue 3 =====
const state = reactive({ count: 0, list: [1, 2, 3], obj: { a: 1 } })

state.count = 10 // ✅ 触发更新
state.newProp = 'hello' // ✅ 触发更新（Proxy 拦截了属性新增）
state.list[0] = 100 // ✅ 触发更新（Proxy 拦截了索引赋值）
state.list.push(4) // ✅ 触发更新（Proxy 拦截了 push 内部的 set）
state.obj.a = 2 // ✅ 触发更新（惰性代理，访问 obj 时已转为 reactive）
delete state.obj.a // ✅ 触发更新（Proxy 拦截了 deleteProperty）
```

---

## 四、为什么 Vue 3 还要保留 ref？

一个常见的问题是：既然 `reactive` 已经能处理对象，为什么还要有 `ref`？直接用 `reactive` 包一层不就行了？

三个原因：

1. **基本类型需要包装。** `Proxy` 只能代理对象，number、string 等基本类型必须包进一个对象里。`ref` 就是这个包装方案。

2. **重新赋值的语义。** `reactive` 在解构或重新赋值时会丢失响应式，因为 Proxy 代理的是对象本身。`ref` 则不受此影响——你随时可以用 `.value` 重新赋值，响应式不会丢失。

   ```javascript
   // reactive 的问题
   const state = reactive({ count: 0 })
   let { count } = state // count 现在是普通数字，不再响应式 ❌
   count = 5 // 不会触发任何更新

   // ref 不存在这个问题
   const count = ref(0) // count 本身是 ref 对象
   count.value = 5 // ✅ 触发更新
   ```

3. **Vue 3 组合式 API 的设计。** `ref` 更适合组合式函数（composables）的返回值——一个独立的、可传递的响应式引用。

---

## 五、总结

从 Vue 2 到 Vue 3，响应式系统的演进本质上是**技术选型随语言能力升级**的过程。

Vue 2 选择 `Object.defineProperty`，是因为它在当时拥有最好的浏览器兼容性。尽管存在数组索引无法监听、新增属性需要 `Vue.set` 等局限，但通过数组方法重写和手动 API 补丁，Vue 2 依然构建了一套完整可用的响应式系统。

Vue 3 选择 `Proxy`，是因为它提供了更强大、更全面的拦截能力，同时浏览器兼容性的格局已经改变（IE11 退出历史舞台）。换来的收益是实打实的：

- **数组、对象新增/删除属性的完整支持**——告别 `Vue.set` 和 `Vue.delete`
- **更优的初始化性能**——惰性代理，只转换用到的部分
- **更精细的依赖收集**——按 key 维度，WeakMap 自动管理生命周期
- **更简洁的代码**——不再需要递归遍历和数组方法重写

理解这些原理，不仅能帮你写出更健壮的代码，也能在遇到"数据变了但视图没更新"这类问题时，脑子里有一张清晰的排障地图。毕竟，知其然，更要知其所以然。
