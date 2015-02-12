var Transform = require('stream').Transform;
var Cursor = require(__dirname+"/cursor.js");
var util = require('util');

// Experimental, but should work fine.
function TransformStream(table, options, connection) {
    this._table = table;
    this._options = options;
    this._cache = [];
    this._pendingCallback = null;
    this._ended = false;
    this._inserting = false;
    this._connection = connection;
    this._highWaterMark = options.highWaterMark || 100;
    this._insertOptions = {};
    this._insertOptions.durability = options.durability || 'hard';
    this._insertOptions.conflict = options.conflict || 'error';
    this._insertOptions.returnChanges = options.returnChanges || true;

    Transform.call(this, {
        objectMode: true,
        highWaterMark: this._highWaterMark
    });
};
util.inherits(TransformStream, Transform);

TransformStream.prototype._transform = function(value, encoding, done) {
    this._cache.push(value);

    if ((this._writableState.lastBufferedRequest != null) && (this._writableState.lastBufferedRequest.chunk !== value)) {
        // There's more data to buffer
        if (this._cache.length < this._highWaterMark-1) {
            // Call done now, and more data will be put in the cache
            done();
        }
        else {
            if (this._inserting === false) {
                // We have to flush
                this._insert();
                // Fill the buffer while we are inserting data
                done();
            }
            else {
                // to call when we are dong inserting to keep buffering
                this._pendingCallback = done;
            }
        }
    }
    else { // We just pushed the last element in the internal buffer
        if (this._inserting === false) {
            // to call when we are dong inserting to maybe flag the end
            this._insert();
            // We can call done now, because we have _flush to close the stream
            done();
        }
        else {
            // There is nothing left in the internal buffer
            // But something is already inserting stuff.
            // to call when we are dong inserting to keep buffering
            this._pendingCallback = done;
        }
    }
}

TransformStream.prototype._insert = function() {
    var self = this;
    self._inserting = true;

    var cache = self._cache;
    self._cache = [];

    self._table.insert(cache, self._insertOptions).run(self._connection).then(function(result) {
        if (self._ended === true) {
            return self.push(null);
        }
        self._inserting = false;
        if (result.errors > 0) {
            self._inserting = false;
            self.emit('error', new Error("Failed to insert some documents:"+JSON.stringify(result, null, 2)));
        }
        else {
            if (self._insertOptions.returnChanges === true) {
                for(var i=0; i<result.changes.length; i++) {
                    self.push(result.changes[i].new_val);
                }
            }
        }
        if (typeof self._pendingCallback === 'function') {
            var pendingCallback = self._pendingCallback;
            self._pendingCallback = null;
            pendingCallback();
        }
    }).error(function(error) {
        self._inserting = false;
        self.emit('error', error);
    });
}

TransformStream.prototype._flush = function() {
    this._ended = true;
    if (this._inserting === false) {
        this.push(null);
    }
}


module.exports = TransformStream;