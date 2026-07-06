// @ts-nocheck

if (!("getOrInsert" in Map.prototype)) {
	Map.prototype.getOrInsert = function(key, defaultValue) {
		if (!this.has(key)) {
			this.set(key, defaultValue)
		}
		return this.get(key)
	}
}

if (!("getOrInsertComputed" in Map.prototype)) {
	Map.prototype.getOrInsertComputed = function(key, callback) {
		if (!this.has(key)) {
			this.set(key, callback(key))
		}
		return this.get(key)
	}
}

if (!("getOrInsert" in WeakMap.prototype)) {
	WeakMap.prototype.getOrInsert = function(key, defaultValue) {
		if (!this.has(key)) {
			this.set(key, defaultValue)
		}
		return this.get(key)
	}
}

if (!("getOrInsertComputed" in WeakMap.prototype)) {
	WeakMap.prototype.getOrInsertComputed = function(key, callback) {
		if (!this.has(key)) {
			this.set(key, callback(key))
		}
		return this.get(key)
	}
}


new WeakMap().getOrInsertComputed
