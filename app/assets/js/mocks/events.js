/**
 * Functional EventEmitter polyfill for the renderer.
 */
class EventEmitter {
    constructor() {
        this._events = Object.create(null);
        this._maxListeners = undefined;
    }

    static get defaultMaxListeners() { return 10; }

    setMaxListeners(n) {
        this._maxListeners = n;
        return this;
    }

    getMaxListeners() {
        return this._maxListeners === undefined ? EventEmitter.defaultMaxListeners : this._maxListeners;
    }

    emit(type, ...args) {
        const handler = this._events[type];
        if (handler === undefined) return false;
        if (typeof handler === 'function') {
            handler.apply(this, args);
        } else {
            const listeners = handler.slice();
            for (let i = 0; i < listeners.length; ++i) {
                listeners[i].apply(this, args);
            }
        }
        return true;
    }

    addListener(type, listener) {
        if (!this._events[type]) {
            this._events[type] = listener;
        } else if (typeof this._events[type] === 'function') {
            this._events[type] = [this._events[type], listener];
        } else {
            this._events[type].push(listener);
        }
        return this;
    }

    on(type, listener) { return this.addListener(type, listener); }

    once(type, listener) {
        const g = (...args) => {
            this.removeListener(type, g);
            listener.apply(this, args);
        }
        g.listener = listener;
        return this.on(type, g);
    }

    removeListener(type, listener) {
        const list = this._events[type];
        if (!list) return this;
        if (list === listener || list.listener === listener) {
            delete this._events[type];
        } else if (typeof list !== 'function') {
            const position = list.findIndex(l => l === listener || l.listener === listener);
            if (position !== -1) {
                list.splice(position, 1);
                if (list.length === 1) this._events[type] = list[0];
            }
        }
        return this;
    }

    off(type, listener) { return this.removeListener(type, listener); }

    removeAllListeners(type) {
        if (type) delete this._events[type];
        else this._events = Object.create(null);
        return this;
    }

    eventNames() { return Object.keys(this._events); }
    listenerCount(type) {
        const list = this._events[type];
        if (!list) return 0;
        return typeof list === 'function' ? 1 : list.length;
    }
}

module.exports = EventEmitter;
module.exports.EventEmitter = EventEmitter;
