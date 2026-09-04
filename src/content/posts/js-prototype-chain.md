---
title: JavaScript 原型与原型链
date: 2026-09-04
summary: 用最少的篇幅讲透原型链：prototype / __proto__ / constructor 三角关系，new 的执行流程，属性查找与遮蔽机制，Object 与 Function 的互相引用，原型继承的三种写法，instanceof 原理与高频面试陷阱。
category: 技术文章
tags: [JavaScript, 原型链, 原型继承, 面试]
sticky: 0
comments: false
---

## 一、三个核心概念（必背）

| 概念          | 谁有                       | 指向                                       | 作用                         |
| ------------- | -------------------------- | ------------------------------------------ | ---------------------------- |
| `prototype`   | **函数**（有构造能力的）   | 一个普通对象                               | `new` 出来实例的"原型"来源   |
| `__proto__`   | **每个对象都有**（含函数） | 该对象实际的原型（内部槽 `[[Prototype]]`） | 实例指向构造函数的 prototype |
| `constructor` | `prototype` 所在对象       | 指回该构造函数                             | 反查构造函数                 |

黄金等式：

```javascript
function Person(name) {
  this.name = name
}
const p = new Person('Tom')

p.__proto__ === Person.prototype // true：实例的原型 = 构造函数的 prototype
Person.prototype.constructor === Person // true：原型默认反指构造函数
p.constructor === Person // true：自己没找到，沿链读到的
p instanceof Person // true
```

补充两个特例：

- **不是所有函数都有 `prototype`**：箭头函数、对象方法简写、`Function.prototype` 都没有（也因此不能被 `new`）。class 与普通函数才有。
- `__proto__` 本质是挂在 `Object.prototype` 上的**访问器属性**（getter/setter），生产代码应改用 `Object.getPrototypeOf()` / `Object.setPrototypeOf()`。

---

## 二、new 到底做了什么

```javascript
function myNew(Ctor, ...args) {
  const obj = Object.create(Ctor.prototype) // ① 新对象，__proto__ 指向 Ctor.prototype
  const res = Ctor.apply(obj, args) // ② this 绑定到 obj 并执行构造函数
  return res && typeof res === 'object' ? res : obj // ③ 返回引用类型则以它为准
}
```

三步铁律：**建对象 → 绑原型 → 绑 this 执行**。若构造函数显式返回一个引用类型，会覆盖默认返回的实例（基本类型则被忽略）。

---

## 三、属性查找机制（原型链的意义所在）

访问 `obj.xxx` 时引擎的执行顺序：

1. 先找 **obj 自有属性**（`hasOwnProperty` 为 true 的）；
2. 没有就沿 `__proto__` **逐级向上**找；
3. 一路到 `Object.prototype` 仍没有、其 `__proto__` 为 `null`，返回 `undefined`。

**继承的本质不是复制，而是"向上委托查找"。**

```javascript
Person.prototype.age = 18
const p = new Person('Tom')

p.hasOwnProperty('age') // false：age 不在自己身上
'age' in p // true：in 会算上原型链

p.age = 20 // 赋值不修改原型，而是在实例上新增自有属性（遮蔽 shadowing）
console.log(p.age) // 20
delete p.age // 删除自有属性后
console.log(p.age) // 18：重新读到原型链上的值
```

> 口诀：**读属性 → 沿链找；写属性 → 就地建**（只对自身生效）；`in` 含链、`hasOwnProperty` 不含链。

---

## 四、整条链背下来（顶层图谱）

```
         Object.prototype ──__proto__──► null        ← 链的终点
              ▲  __proto__
              │
  ┌───────────┴─────────────────────────────┐
  │  Array.prototype  Person.prototype ...   │  (普通对象，其原型是 Object.prototype)
  └───────────┬─────────────────────────────┘
              ▲  __proto__
  ┌───────────┴─────────────────────────────┐
  │  arr  p   （new 出来的实例）              │
  └─────────────────────────────────────────┘
```

内置对象同理，最终都汇到 `Object.prototype` 收口：

```javascript
const arr = []
arr.__proto__ === Array.prototype // true
Array.prototype.__proto__ === Object.prototype // true
Object.prototype.__proto__ === null // true：终点，再往上没有了
```

所以所有对象（数组、日期、函数、实例）都能"免费"调用 `toString`、`hasOwnProperty` 等方法——它们都来自共同的祖先 `Object.prototype`。

---

## 五、Object 与 Function 的"鸡生蛋"

函数也是对象，因此函数同时有两种身份：

```javascript
function fn() {}

fn.__proto__ === Function.prototype // true：函数是 Function 的实例
Function.prototype.__proto__ === Object.prototype // true：函数也终究是对象
Object.prototype.__proto__ === null // 收口

// 互相引用（引擎内建的特殊关系）
Object.__proto__ === Function.prototype // true：Object 是构造函数，也是函数
Function.__proto__ === Function.prototype // true：Function 自己指向自己的 prototype
```

**结论**：任意对象沿 `__proto__` 往上走，必然经过 `Function.prototype`（若是函数）与 `Object.prototype`，最后到 `null`。所以 `Function instanceof Object` 和 `Object instanceof Function` 都为 `true`。

---

## 六、原型继承的三种写法

### 1. 构造函数 + 手动挂 prototype（经典写法）

```javascript
function Animal(name) {
  this.name = name
}
Animal.prototype.eat = function () {
  console.log(this.name + ' 在吃饭')
}

function Dog(name) {
  Animal.call(this, name) // ① 继承实例属性
}
Dog.prototype = Object.create(Animal.prototype) // ② 继承方法：断开与 Animal.prototype 的直接引用
Dog.prototype.constructor = Dog // ③ 修正 constructor 指回 Dog
Dog.prototype.bark = function () {
  console.log(this.name + ' 汪汪')
}
```

**为什么要用 `Object.create` 而不是 `Dog.prototype = Animal.prototype`？**

直接赋值会让两者指向**同一个对象**，Dog 加的方法会污染 Animal；`Object.create` 生成一个 `__proto__` 指向 `Animal.prototype` 的新对象，既不共享又能沿链查到。替换原型后 `constructor` 丢失，需要手动补回。

### 2. Object.create 纯原型继承

```javascript
const animal = {
  eat() {
    console.log(this.name + ' eat')
  },
}
const dog = Object.create(animal) // dog.__proto__ === animal
dog.name = '旺财'
dog.eat() // 沿链找到 eat
```

### 3. class 语法糖

```javascript
class Animal {
  constructor(name) {
    this.name = name
  }
  eat() {
    console.log(this.name + ' 在吃饭')
  }
}

class Dog extends Animal {
  constructor(name) {
    super(name)
  } // 必须先 super 再访问 this
  bark() {
    console.log(this.name + ' 汪汪')
  }
}
```

`extends` 底层仍是原型链，但比经典写法多一条"自身级"链接：

- **实例方法**：`Dog.prototype.__proto__ === Animal.prototype`
- **静态方法继承**：`Dog.__proto__ === Animal`（Dog 自身也是 Animal 的"实例"）——这是普通构造函数写法没有的。

---

## 七、instanceof 原理

`obj instanceof Ctor`：**沿着 obj 的原型链查找是否存在 `Ctor.prototype`**。

```javascript
function myInstanceof(obj, Ctor) {
  let proto = Object.getPrototypeOf(obj)
  while (proto) {
    if (proto === Ctor.prototype) return true
    proto = Object.getPrototypeOf(proto) // 逐级向上
  }
  return false
}

myInstanceof([], Array) // true
myInstanceof([], Object) // true：一路找到 Object.prototype
myInstanceof({}, Array) // false
```

**注意**：

- instanceof 查的是"**原型链上有没有这个 prototype**"，而非类型本身。
- 跨 iframe / 多窗口（如两个页面里的数组）时，原型对象不同，instanceof 会失效，此时可用 `Array.isArray()` 这类鸭子类型判断。
- 可通过 `Symbol.hasInstance` 自定义 `instanceof` 的行为。

---

## 八、高频误区与面试追问

**误区 1："原型链上改属性，所有实例都跟着变。"**

**正解**：只有**读**才会沿链向上；**赋值**永远在当前对象上新增/覆盖自有属性（遮蔽）。想改原型本身，必须拿到原型对象操作：`p.constructor.prototype.x = 1` 或 `Object.getPrototypeOf(p).x = 1`。

**误区 2："`__proto__` 就是原型。"**

**正解**：`__proto__` 只是访问器，真正存储原型的是内部槽 `[[Prototype]]`。它由引擎维护，可用 `Object.create`、构造函数的 `prototype`、`extends` 等方式设置。

**误区 3："`instanceof` 能判断原始值类型。"**

**正解**：`1 instanceof Number` 是 `false`，instanceof 只关心原型链、不装箱。判断原始值用 `typeof` 或 `Object.prototype.toString.call()`。

**误区 4："可以随便给 `Object.prototype` 加方法方便全局用。"**

**正解**：Monkey Patch 会污染所有对象，且可枚举的方法会让 `for...in` 遍历到、易与第三方库冲突。排查使用 `for (const k in obj)` 时应配合 `obj.hasOwnProperty(k)`，或用 `Object.keys()` 只拿自有可枚举属性。

**追问：`Object.create(null)` 创建的对象有什么不同？**

**正解**：它的 `__proto__` 是 `null`，没有任何祖先，也就没有 `toString`、`hasOwnProperty` 等方法——常用来做**无污染的纯字典 / Map 替代品**，但调用其原型方法会直接报错。

---

## 九、总结速记口诀（面试背诵版）

> **"函数有 prototype，对象有 **proto**，实例指函数，原型反指 constructor；属性读沿链、写就地；函数与 Object 互为实例，最终汇到 Object.prototype 归 null；extends 是糖，方法链上加、静态自身连；instanceof 只看链上有无此 prototype。"**
