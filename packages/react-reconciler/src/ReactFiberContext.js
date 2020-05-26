/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Fiber} from './ReactFiber';
import type {StackCursor} from './ReactFiberStack';

import {isFiberMounted} from 'react-reconciler/reflection';
import {ClassComponent, HostRoot} from 'shared/ReactWorkTags';
import getComponentName from 'shared/getComponentName';
import invariant from 'shared/invariant';
import warningWithoutStack from 'shared/warningWithoutStack';
import checkPropTypes from 'prop-types/checkPropTypes';

import {setCurrentPhase, getCurrentFiberStackInDev} from './ReactCurrentFiber';
import {startPhaseTimer, stopPhaseTimer} from './ReactDebugFiberPerf';
import {createCursor, push, pop} from './ReactFiberStack';

let warnedAboutMissingGetChildContext;

if (__DEV__) {
  warnedAboutMissingGetChildContext = {};
}

export const emptyContextObject = {};
if (__DEV__) {
  Object.freeze(emptyContextObject);
}

/**
 * legacyContextProvider
 * legacyContextProvider
 * legacyContextProvider
 * legacyContextProvider
 * legacyContextProvider
 * legacyContextProvider
 * legacyContextProvider
 * legacyContextProvider
 * legacyContextProvider
 * legacyContextProvider
 * legacyContextProvider
 */

// 注释已经非常明确，就不再翻译
// A cursor to the current merged context object on the stack.
/**
 * 记录当前组件和他的父树一起提供给子树的childContext对象，初始默认是emptyContextObject {}。
 */
let contextStackCursor: StackCursor<Object> = createCursor(emptyContextObject);
// A cursor to a boolean indicating whether the context has changed.
let didPerformWorkStackCursor: StackCursor<boolean> = createCursor(false);
// Keep track of the previous context object that was on the stack.
// We use this to get access to the parent context after we have already
// pushed the next context provider, and now need to merge their contexts.
let previousContext: Object = emptyContextObject;

function getUnmaskedContext(
  workInProgress: Fiber,
  Component: Function,
  didPushOwnContextIfProvider: boolean,
): Object {
  if (didPushOwnContextIfProvider && isContextProvider(Component)) {
    // If the fiber is a context provider itself, when we read its context
    // we may have already pushed its own child context on the stack. A context
    // provider should not "see" its own child context. Therefore we read the
    // previous (parent) context instead for a context provider.
    return previousContext;
  }
  return contextStackCursor.current;
}

function cacheContext(
  workInProgress: Fiber,
  unmaskedContext: Object,
  maskedContext: Object,
): void {
  const instance = workInProgress.stateNode;
  instance.__reactInternalMemoizedUnmaskedChildContext = unmaskedContext;
  instance.__reactInternalMemoizedMaskedChildContext = maskedContext;
}

function getMaskedContext(
  workInProgress: Fiber,
  unmaskedContext: Object,
): Object {
  const type = workInProgress.type;
  const contextTypes = type.contextTypes;
  if (!contextTypes) {
    return emptyContextObject;
  }

  // Avoid recreating masked context unless unmasked context has changed.
  // Failing to do this will result in unnecessary calls to componentWillReceiveProps.
  // This may trigger infinite loops if componentWillReceiveProps calls setState.
  const instance = workInProgress.stateNode;
  if (
    instance &&
    instance.__reactInternalMemoizedUnmaskedChildContext === unmaskedContext
  ) {
    return instance.__reactInternalMemoizedMaskedChildContext;
  }

  const context = {};
  for (let key in contextTypes) {
    context[key] = unmaskedContext[key];
  }

  if (__DEV__) {
    const name = getComponentName(type) || 'Unknown';
    checkPropTypes(
      contextTypes,
      context,
      'context',
      name,
      getCurrentFiberStackInDev,
    );
  }

  // Cache unmasked context so we can avoid recreating masked context unless necessary.
  // Context is created before the class component is instantiated so check for instance.
  if (instance) {
    cacheContext(workInProgress, unmaskedContext, context);
  }

  return context;
}

function hasContextChanged(): boolean {
  return didPerformWorkStackCursor.current;
}

/**
 * 当父级 class component 有一个名为 childContextType 的静态方法时，则说明为 legacyContextProvider
 * 参考：https://www.jianshu.com/p/392125a76c6f
 * // 在父组件中 定义上下文类型
    static childContextType = {
        users: PropTypes.array,
        userMap: PropTypes.object
    }

    // 在父组件中 给context填充数据
    getChildContext() {
        return { // 返回context对象
            users: this.getUsers(),
            userMap: this.getUserMap()
        }
    }

    // 在子组件中 告知我们要获取 context
    static contextTypes = {
        users: PropTypes.array
    }

    // 在子组件中 读取父级的 context 值
    {this.context.users.xxxx}

 * @param {ClassComponent} type class 组件
 */
function isContextProvider(type: Function): boolean {
  const childContextTypes = type.childContextTypes;
  return childContextTypes !== null && childContextTypes !== undefined;
}

function popContext(fiber: Fiber): void {
  pop(didPerformWorkStackCursor, fiber);
  pop(contextStackCursor, fiber);
}

function popTopLevelContextObject(fiber: Fiber): void {
  pop(didPerformWorkStackCursor, fiber);
  pop(contextStackCursor, fiber);
}

/**
 * updateHostRoot中 hostRootContainer.pendingContext !== null 时会调用
 * @param {*} fiber 
 * @param {*} context 
 * @param {*} didChange 
 */
function pushTopLevelContextObject(
  fiber: Fiber,
  context: Object,
  didChange: boolean,
): void {
  invariant(
    contextStackCursor.current === emptyContextObject,
    'Unexpected context found on stack. ' +
      'This error is likely caused by a bug in React. Please file an issue.',
  );

  push(contextStackCursor, context, fiber);
  push(didPerformWorkStackCursor, didChange, fiber);
}

/**
 * merge 父级和当前 context 
 * @param {*} fiber 
 * @param {*} type 
 * @param {*} parentContext 
 * @returns 返回 merge 完成的 context
 */
function processChildContext(
  fiber: Fiber,
  type: any,
  parentContext: Object,
): Object {
  const instance = fiber.stateNode;
  const childContextTypes = type.childContextTypes;

  // TODO (bvaughn) Replace this behavior with an invariant() in the future.
  // It has only been added in Fiber to match the (unintentional) behavior in Stack.
  if (typeof instance.getChildContext !== 'function') {
    if (__DEV__) {
      const componentName = getComponentName(type) || 'Unknown';

      if (!warnedAboutMissingGetChildContext[componentName]) {
        warnedAboutMissingGetChildContext[componentName] = true;
        warningWithoutStack(
          false,
          '%s.childContextTypes is specified but there is no getChildContext() method ' +
            'on the instance. You can either define getChildContext() on %s or remove ' +
            'childContextTypes from it.',
          componentName,
          componentName,
        );
      }
    }
    return parentContext;
  }

  let childContext;
  if (__DEV__) {
    setCurrentPhase('getChildContext');
  }
  startPhaseTimer(fiber, 'getChildContext');
  childContext = instance.getChildContext();
  stopPhaseTimer();
  if (__DEV__) {
    setCurrentPhase(null);
  }
  for (let contextKey in childContext) {
    invariant(
      contextKey in childContextTypes,
      '%s.getChildContext(): key "%s" is not defined in childContextTypes.',
      getComponentName(type) || 'Unknown',
      contextKey,
    );
  }
  if (__DEV__) {
    const name = getComponentName(type) || 'Unknown';
    checkPropTypes(
      childContextTypes,
      childContext,
      'child context',
      name,
      // In practice, there is one case in which we won't get a stack. It's when
      // somebody calls unstable_renderSubtreeIntoContainer() and we process
      // context from the parent component instance. The stack will be missing
      // because it's outside of the reconciliation, and so the pointer has not
      // been set. This is rare and doesn't matter. We'll also remove that API.
      getCurrentFiberStackInDev,
    );
  }

  return {...parentContext, ...childContext};
}

/**
 * 除了 HostContainer（调用的是这个 pushTopLevelContextObject 而不是 pushContextProvider） 以外只有 ClassComponent 能够提供 childContext，
 * 在 updateClassComponent 的过程中会调用 pushContextProvider 来推入新的子树 context 对象。
 * @param {*} workInProgress 
 */
function pushContextProvider(workInProgress: Fiber): boolean {
  // 已经被 new 完的 class 组件实例
  const instance = workInProgress.stateNode; 
  // We push the context as early as possible to ensure stack integrity.
  // If the instance does not exist yet, we will push null at first,
  // and replace it on the stack later when invalidating the context.
  // 拿到父级和自己 context 的集合，但是在 updateClassComponent 调用这个方法的时候并没有计算出新的state，所以是否有新的context也是未知, 
  // 在后续finishClassComponent的时候如果state或者props有更新，那么需要重新计算context，会执行invalidateContextProvider
  const memoizedMergedChildContext =
    (instance && instance.__reactInternalMemoizedMergedChildContext) ||
    emptyContextObject;

  // Remember the parent context so we can merge with it later.
  // Inherit the parent's did-perform-work value to avoid inadvertently blocking updates.
  // 父树提供的 context 的集合（合并了所有父级）
  previousContext = contextStackCursor.current;
  // 使得 contextStackCursor.current 指向父级和自身的 context merge 后的集合，然后子树就可以用 this.context 拿到父级了
  push(contextStackCursor, memoizedMergedChildContext, workInProgress);
  push(
    didPerformWorkStackCursor,
    didPerformWorkStackCursor.current,
    workInProgress,
  );

  return true;
}

/**
 * 如果 class component 不存在，则在 updateClassComponent 中会先执行 pushContextProvider 把当前一级的 context 设置为 null，
 * 在后续 finishClassComponent 的时候如果 state 或者 props 有更新，那么需要重新计算 context，会执行 invalidateContextProvider
 * @param {*} workInProgress 
 * @param {*} type 
 * @param {*} didChange 
 */
function invalidateContextProvider(
  workInProgress: Fiber,
  type: any,
  didChange: boolean,
): void {
  const instance = workInProgress.stateNode;
  invariant(
    instance,
    'Expected to have an instance by this point. ' +
      'This error is likely caused by a bug in React. Please file an issue.',
  );

  if (didChange) {
    // Merge parent and own context.
    // Skip this if we're not updating due to sCU.
    // This avoids unnecessarily recomputing memoized values.

    // 综合了父级和自身的 context 的集合
    const mergedContext = processChildContext(
      workInProgress,
      type,
      previousContext,
    );

    // 将这一次的结果缓存下来，等到下一次 classComponent 更新的时候在 pushContenxtProvider 中就可以拿到缓存的值，减少运算
    instance.__reactInternalMemoizedMergedChildContext = mergedContext;


    // 由于之前对于当前组件已经 push （pushContextProvider）过一次了，所以这里要先pop再push
    // Replace the old (or empty) context with the new one.
    // It is important to unwind the context in the reverse order.
    pop(didPerformWorkStackCursor, workInProgress);
    pop(contextStackCursor, workInProgress);
    // Now push the new context and mark that it has changed.
    push(contextStackCursor, mergedContext, workInProgress);
    push(didPerformWorkStackCursor, didChange, workInProgress);
  } else {
    pop(didPerformWorkStackCursor, workInProgress);
    push(didPerformWorkStackCursor, didChange, workInProgress);
  }
}

function findCurrentUnmaskedContext(fiber: Fiber): Object {
  // Currently this is only used with renderSubtreeIntoContainer; not sure if it
  // makes sense elsewhere
  invariant(
    isFiberMounted(fiber) && fiber.tag === ClassComponent,
    'Expected subtree parent to be a mounted class component. ' +
      'This error is likely caused by a bug in React. Please file an issue.',
  );

  let node = fiber;
  do {
    switch (node.tag) {
      case HostRoot:
        return node.stateNode.context;
      case ClassComponent: {
        const Component = node.type;
        if (isContextProvider(Component)) {
          return node.stateNode.__reactInternalMemoizedMergedChildContext;
        }
        break;
      }
    }
    node = node.return;
  } while (node !== null);
  invariant(
    false,
    'Found unexpected detached subtree parent. ' +
      'This error is likely caused by a bug in React. Please file an issue.',
  );
}

export {
  getUnmaskedContext,
  cacheContext,
  getMaskedContext,
  hasContextChanged,
  popContext,
  popTopLevelContextObject,
  pushTopLevelContextObject,
  processChildContext,
  isContextProvider,
  pushContextProvider,
  invalidateContextProvider,
  findCurrentUnmaskedContext,
};
