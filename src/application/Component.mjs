/*
 * If not stated otherwise in this file or this component's LICENSE file the
 * following copyright and licenses apply:
 *
 * Copyright 2020 RDK Management
 *
 * Licensed under the Apache License, Version 2.0 (the License);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Element from "../tree/Element.mjs";
import Utils from "../tree/Utils.mjs";
import StateMachine from "./StateMachine.mjs";

/**
 * @extends StateMachine
 */
export default class Component extends Element {

    constructor(stage, properties) {
        super(stage);

        // Encapsulate tags to prevent leaking.
        this.tagRoot = true;

        if (Utils.isObjectLiteral(properties)) {
            Object.assign(this, properties);
        }

        this.__initialized = false;
        this.__firstActive = false;
        this.__firstEnable = false;

        this.__signals = undefined;

        this.__passSignals = undefined;

        this.__construct();

        // Quick-apply template.
        const func = this.constructor.getTemplateFunc();
        func.f(this, func.a);

        this._build();
    }

    __start() {
        // we gather bindings before we initialize the statemachine
        // so we can call them from routed setters
        if (!this.constructor.hasOwnProperty("__bindings")) {
            this.constructor.__bindings = Component.translateBindings(
                Component.getPropertyBinding(this)
            );
        }

        StateMachine.setupStateMachine(this);
        this._onStateChange = Component.prototype.__onStateChange;
    }

    get state() {
        return this._getState();
    }

    __onStateChange() {
        /* FIXME: Workaround for case, where application was shut but component still lives */
        if (this.application) {
            this.application.updateFocusPath();
        }
    }

    _refocus() {
        /* FIXME: Workaround for case, where application was shut but component still lives */
        if (this.application) {
            this.application.updateFocusPath();
        }
    }

    /**
     * Returns a high-performance template patcher.
     */
    static getTemplateFunc() {
        // We need a different template function per patch id.
        const name = "_templateFunc";

        // Be careful with class-based static inheritance.
        const hasName = '__has' + name;
        if (this[hasName] !== this) {
            this[hasName] = this;
            this[name] = this.parseTemplate(this._template());
        }
        return this[name];
    }

    static parseTemplate(obj) {
        const context = {
            loc: [],
            store: [],
            rid: 0
        };

        this.parseTemplateRec(obj, context, "element");

        const code = context.loc.join(";\n");
        const f = new Function("element", "store", code);
        return {f: f, a: context.store};
    }

    static parseTemplateRec(obj, context, cursor) {
        const store = context.store;
        const loc = context.loc;
        const keys = Object.keys(obj);

        keys.forEach(key => {
            let value = obj[key];
            if (Utils.isUcChar(key.charCodeAt(0))) {
                // Value must be expanded as well.
                if (Utils.isObjectLiteral(value)) {
                    // Ref.
                    const childCursor = `r${key.replace(/[^a-z0-9]/gi, "") + context.rid}`;
                    let type = value.type ? value.type : Element;
                    if (type === Element) {
                        loc.push(`const ${childCursor} = element.stage.createElement()`);
                    } else {
                        store.push(type);
                        loc.push(`const ${childCursor} = new store[${store.length - 1}](${cursor}.stage)`);
                    }
                    loc.push(`${childCursor}.ref = "${key}"`);
                    context.rid++;

                    // Enter sub.
                    this.parseTemplateRec(value, context, childCursor);

                    loc.push(`${cursor}.childList.add(${childCursor})`);
                } else if (Utils.isObject(value)) {
                    // Dynamic assignment.
                    store.push(value);
                    loc.push(`${cursor}.childList.add(store[${store.length - 1}])`);
                }
            } else {
                if (key === "text") {
                    const propKey = cursor + "__text";
                    loc.push(`const ${propKey} = ${cursor}.enableTextTexture()`);
                    this.parseTemplatePropRec(value, context, propKey);
                } else if (key === "texture" && Utils.isObjectLiteral(value)) {
                    const propKey = cursor + "__texture";
                    const type = value.type;
                    if (type) {
                        store.push(type);
                        loc.push(`const ${propKey} = new store[${store.length - 1}](${cursor}.stage)`);
                        this.parseTemplatePropRec(value, context, propKey);
                        loc.push(`${cursor}["${key}"] = ${propKey}`);
                    } else {
                        loc.push(`${propKey} = ${cursor}.texture`);
                        this.parseTemplatePropRec(value, context, propKey);
                    }
                } else {
                    // we assume the origin of undefined is due to
                    // property binding so we skip
                    // @todo: default value per property
                    if (value === undefined) {
                        return;
                    }

                    // Property;
                    if (Utils.isNumber(value)) {
                        loc.push(`${cursor}["${key}"] = ${value}`);
                    } else if (Utils.isBoolean(value)) {
                        loc.push(`${cursor}["${key}"] = ${value ? "true" : "false"}`);
                    } else if (Utils.isObject(value) || Array.isArray(value)) {
                        // Dynamic assignment.
                        // Because literal objects may contain dynamics, we store the full object.
                        store.push(value);
                        loc.push(`${cursor}["${key}"] = store[${store.length - 1}]`);
                    } else {
                        // String etc.
                        loc.push(`${cursor}["${key}"] = ${JSON.stringify(value)}`);
                    }
                }
            }
        });
    }

    static parseTemplatePropRec(obj, context, cursor) {
        const store = context.store;
        const loc = context.loc;
        const keys = Object.keys(obj);

        keys.forEach(key => {
            if (key !== "type") {
                const value = obj[key];
                if (Utils.isNumber(value)) {
                    loc.push(`${cursor}["${key}"] = ${value}`);
                } else if (Utils.isBoolean(value)) {
                    loc.push(`${cursor}["${key}"] = ${value ? "true" : "false"}`);
                } else if (Utils.isObject(value) || Array.isArray(value)) {
                    // Dynamic assignment.
                    // Because literal objects may contain dynamics, we store the full object.
                    store.push(value);
                    loc.push(`${cursor}["${key}"] = store[${store.length - 1}]`);
                } else {
                    // String etc.
                    loc.push(`${cursor}["${key}"] = ${JSON.stringify(value)}`);
                }
            }
        });
    }

    static getPropertyBinding(instance) {
        let template = instance.constructor._template.toString();
        // cleanup so we can simplify our regex pattern
        template = template.replace(/[\n\s]/g, '');

        const hasBindings = /:\s*this\./ig;
        if (!hasBindings.test(template)) {
            return [];
        }

        const getBindings = /([a-z0-9@$_]+):(this\.[a-z0-9@$_.]+)/ig;
        const bindings = template.match(getBindings);

        if (bindings && bindings.length) {
            return bindings.map((binding) => {
                const locator = new RegExp(`([A-Z][A-Za-z0-9_@$]+):\{([^{]*?${binding}[^}]*?)\}`);
                const obj = locator.exec(template);
                if (obj && obj.length) {
                    return {
                        [`${obj[1]}`]: Utils.stringToObject(binding)
                    };
                }
            }).filter(Boolean);
        }
        return [];
    }

    static translateBindings(obj = []) {
        const combined = new Map();
        const binds = obj.reduce((bindings, binding) => {
            const tag = Object.keys(binding)[0];
            const value = binding[tag];
            const getBinding = /this\.([a-zA-Z0-9@$_.]+)/;
            const getGroupName = /([a-zA-Z0-9@$_]+)\./;
            const getGroupProp = /\.([a-zA-Z0-9@$_]+)/;

            Object.keys(value).forEach((prop) => {
                const matches = getBinding.exec(value[prop]);
                if (matches && matches[1].indexOf(".") !== -1) {
                    let bucket = [];
                    let nameMatch = getGroupName.exec(matches[1]);

                    const group = nameMatch ? nameMatch[1] : "root";
                    if (combined.has(group)) {
                        bucket = combined.get(group);
                    }

                    const argProp = getGroupProp.exec(matches[1]);
                    if (argProp && argProp.length) {
                        bucket.push({el: prop, arg: argProp[1], tag});
                        combined.set(group, bucket);
                    }
                } else if (matches && !bindings.has(prop)) {
                    let code = `this.tag('${tag}').`;
                    code += prop === "link" ? "patch(arguments[0]);" : `${prop} = arguments[0];`;
                    bindings.set( matches[1], code);
                }
            });
            return bindings;
        }, new Map());

        if (combined.size) {
            const loc = [
                `const _store_ = arguments[0];`
            ];
            for (const [setter, props] of combined.entries()) {
                props.forEach((prop) => {
                    loc.push(`this.tag('${prop.tag}').${prop.el} = _store_['${prop.arg}'];`);
                });
                binds.set(setter, loc.join(''));
            }
        }
        return binds;
    }

    _onSetup() {
        if (!this.__initialized) {
            this._setup();
        }
    }

    _setup() {
    }

    _onAttach() {
        if (!this.__initialized) {
            this.__init();
            this.__initialized = true;
        }

        this._attach();
    }

    _attach() {
    }

    _onDetach() {
        this._detach();
    }

    _detach() {
    }

    _onEnabled() {
        if (!this.__firstEnable) {
            this._firstEnable();
            this.__firstEnable = true;
        }

        this._enable();
    }

    _firstEnable() {
    }

    _enable() {
    }

    _onDisabled() {
        this._disable();
    }

    _disable() {
    }

    _onActive() {
        if (!this.__firstActive) {
            this._firstActive();
            this.__firstActive = true;
        }

        this._active();
    }

    _firstActive() {
    }

    _active() {
    }

    _onInactive() {
        this._inactive();
    }

    _inactive() {
    }

    get application() {
        return this.stage.application;
    }

    __construct() {
        this._construct();
    }

    _construct() {
    }

    _build() {
    }

    __init() {
        this._init();
    }

    _init() {
    }

    _focus(newTarget, prevTarget) {
    }

    _unfocus(newTarget) {
    }

    _focusChange(target, newTarget) {
    }

    _getFocused() {
        // Override to delegate focus to child components.
        return this;
    }

    _setFocusSettings(settings) {
        // Override to add custom settings. See Application._handleFocusSettings().
    }

    _handleFocusSettings(settings) {
        // Override to react on custom settings. See Application._handleFocusSettings().
    }

    static _template() {
        return {};
    }

    hasFinalFocus() {
        let path = this.application._focusPath;
        return path && path.length && path[path.length - 1] === this;
    }

    hasFocus() {
        let path = this.application._focusPath;
        return path && (path.indexOf(this) >= 0);
    }

    get cparent() {
        return Component.getParent(this);
    }

    seekAncestorByType(type) {
        let c = this.cparent;
        while (c) {
            if (c.constructor === type) {
                return c;
            }
            c = c.cparent;
        }
    }

    getSharedAncestorComponent(element) {
        let ancestor = this.getSharedAncestor(element);
        while (ancestor && !ancestor.isComponent) {
            ancestor = ancestor.parent;
        }
        return ancestor;
    }

    get signals() {
        return this.__signals;
    }

    set signals(v) {
        if (!Utils.isObjectLiteral(v)) {
            this._throwError("Signals: specify an object with signal-to-fire mappings");
        }
        this.__signals = v;
    }

    set alterSignals(v) {
        if (!Utils.isObjectLiteral(v)) {
            this._throwError("Signals: specify an object with signal-to-fire mappings");
        }
        if (!this.__signals) {
            this.__signals = {};
        }
        for (let key in v) {
            const d = v[key];
            if (d === undefined) {
                delete this.__signals[key];
            } else {
                this.__signals[key] = v;
            }
        }
    }

    get passSignals() {
        return this.__passSignals || {};
    }

    set passSignals(v) {
        this.__passSignals = Object.assign(this.__passSignals || {}, v);
    }

    set alterPassSignals(v) {
        if (!Utils.isObjectLiteral(v)) {
            this._throwError("Signals: specify an object with signal-to-fire mappings");
        }
        if (!this.__passSignals) {
            this.__passSignals = {};
        }
        for (let key in v) {
            const d = v[key];
            if (d === undefined) {
                delete this.__passSignals[key];
            } else {
                this.__passSignals[key] = v;
            }
        }
    }

    /**
     * Signals the parent of the specified event.
     * A parent/ancestor that wishes to handle the signal should set the 'signals' property on this component.
     * @param {string} event
     * @param {...*} args
     */
    signal(event, ...args) {
        return this._signal(event, args);
    }

    _signal(event, args) {
        const signalParent = this._getParentSignalHandler();
        if (signalParent) {
            if (this.__signals) {
                let fireEvent = this.__signals[event];
                if (fireEvent === false) {
                    // Ignore event.
                    return;
                }
                if (fireEvent) {
                    if (fireEvent === true) {
                        fireEvent = event;
                    }

                    if (signalParent._hasMethod(fireEvent)) {
                        return signalParent[fireEvent](...args);
                    }
                }
            }

            let passSignal = (this.__passSignals && this.__passSignals[event]);
            if (passSignal) {
                // Bubble up.
                if (passSignal && passSignal !== true) {
                    // Replace signal name.
                    event = passSignal;
                }

                return signalParent._signal(event, args);
            }
        }
    }

    _getParentSignalHandler() {
        return this.cparent ? this.cparent._getSignalHandler() : null;
    }

    _getSignalHandler() {
        if (this._signalProxy) {
            return this.cparent ? this.cparent._getSignalHandler() : null;
        }
        return this;
    }

    get _signalProxy() {
        return false;
    }

    fireAncestors(name, ...args) {
        if (!name.startsWith('$')) {
            throw new Error("Ancestor event name must be prefixed by dollar sign.");
        }

        const parent = this._getParentSignalHandler();
        if (parent) {
            return parent._doFireAncestors(name, args);
        }
    }

    _doFireAncestors(name, args) {
        if (this._hasMethod(name)) {
            return this.fire(name, ...args);
        } else {
            const signalParent = this._getParentSignalHandler();
            if (signalParent) {
                return signalParent._doFireAncestors(name, args);
            }
        }
    }

    static collectSubComponents(subs, element) {
        if (element.hasChildren()) {
            const childList = element.__childList;
            for (let i = 0, n = childList.length; i < n; i++) {
                const child = childList.getAt(i);
                if (child.isComponent) {
                    subs.push(child);
                } else {
                    Component.collectSubComponents(subs, child);
                }
            }
        }
    }

    static getComponent(element) {
        let parent = element;
        while (parent && !parent.isComponent) {
            parent = parent.parent;
        }
        return parent;
    }

    static getParent(element) {
        return Component.getComponent(element.parent);
    }
}

Component.prototype.isComponent = true;
