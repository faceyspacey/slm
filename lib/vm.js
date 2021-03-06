var ampRe = /&/g;
var escapeRe = /[&<>"]/;
var gtRe = />/g;
var ltRe = /</g;
var quotRe = /"/g;

function SafeStr(val) {
  this.htmlSafe = true;
  this._val = val;
}

SafeStr.prototype.toString = function() {
  return this._val;
};

function safe(val) {
  if (!val || val.htmlSafe) {
    return val;
  }

  return new SafeStr(val);
}

function j(val) {
  var str = JSON.stringify(val) + '';
  return str.replace(/<\//g, "<\\/");
}

function escape(str) {
  if (typeof str !== 'string') {
    if (!str) {
      return '';
    }
    if (str.htmlSafe) {
      return str.toString();
    }
    str = str.toString();
  }

  if (escapeRe.test(str)) {
    if (str.indexOf('&') !== -1) {
      str = str.replace(ampRe, '&amp;');
    }
    if (str.indexOf('<') !== -1) {
      str = str.replace(ltRe, '&lt;');
    }
    if (str.indexOf('>') !== -1) {
      str = str.replace(gtRe, '&gt;');
    }
    if (str.indexOf('"') !== -1) {
      str = str.replace(quotRe, '&quot;');
    }
  }

  return str;
}

function rejectEmpty(arr) {
  var res = [];

  for (var i = 0, l = arr.length; i < l; i++) {
    var el = arr[i];
    if (el !== null && el.length) {
      res.push(el);
    }
  }

  return res;
}

function flatten(arr) {
  return arr.reduce(function(acc, val) {
    if (val === null) {
      return acc;
    }
    // TODO: investigate why test fails with this line
    // return acc.concat(val.constructor === Array ? flatten(val) : val.toString());
    return acc.concat(Array.isArray(val) ? flatten(val) : val.toString());
  }, []);
}

VM._cache = {};

function VM() {
  this.reset();
  this.template = this.basePath = null;
  this._cache = VM._cache;
}

var VMProto = VM.prototype;

VM.escape = VMProto.escape = escape;
VM.safe = VMProto.safe = safe;
VMProto.j = j;
VMProto.flatten = flatten;
VMProto.rejectEmpty = rejectEmpty;

VMProto.resetCache = function() {
  this._cache = VM._cache = {};
};

VMProto.cache = function(name, value) {
  this._cache[name] = value;
};

VMProto.rebind = function() {
  this._content = this.content.bind(this);
  this._extend = this.extend.bind(this);
  this._partial = this.partial.bind(this);
  this._mixin = this.mixin.bind(this);
};

VMProto._loadWithCache = function(path) {
  var fn = this._cache[path];
  if (fn) {
    return fn;
  }

  var result = this._cache[path] = this._loadWithoutCache(path);
  return result;
};

VMProto._load = VMProto._loadWithCache;

/*
  Prepare VM for next template rendering
*/
VMProto.reset = function() {
  this._contents = {};
  this._mixins = {};
  this.res = '';
  this.stack = [];
  this.m = null;
};

/*
  Pop stack to sp
*/
VMProto.pop = function(sp) {
  var currentFilename = this.filename;
  var l = this.stack.length;
  while (sp < l--) {
    this.filename = this.stack.pop();
    this._load(this.filename).call(this.m, this);
  }
  this.filename = currentFilename;
  return this.res;
};

VMProto.extend = function(path) {
  this.stack.push(this._resolvePath(path));
};

VMProto.partial = function(path, model, cb) {
  var stashedResult = this.res;
  if (cb) {
    this.res = cb.call(this.m, this);
  }

  if (model === undefined) {
    model = this.m;
  }

  path = this._resolvePath(path);

  var f = this._load(path), stashedFilename = this.filename, stashedModel = this.m;
  this.filename = path;
  var res = safe(f.call(this.m = model, this));
  this.m = stashedModel;
  this.filename = stashedFilename;
  this.res = stashedResult;
  return res;
};

VMProto.content = function() {
  var cb, mod, name;
  switch (arguments.length) {
    case 0: // return main content
      return safe(this.res);
    case 1: // return named content
      return safe(this._contents[arguments[0]] || '');
    case 2: // capture named content
      name = arguments[0];
      cb = arguments[1];
      if (name) {
        // capturing block
        this._contents[name] = cb.call(this.m);
        return '';
      }
      return cb.call(this.m);
    case 3: // content operations: default, append, prepend
      name = arguments[0];
      mod = arguments[1];
      cb = arguments[2];
      var contents = this._contents[name] || '';
      switch (mod) {
        case 'default':
          return safe(contents || cb.call(this.m));
        case 'append':
          this._contents[name] = contents + cb.call(this.m);
          return '';
        case 'prepend':
          this._contents[name] = cb.call(this.m) + contents;
          return '';
      }
  }
};

VMProto.mixin = function() {
  var name = arguments[0];

  var lastArgument = arguments[arguments.length - 1];
  if (typeof lastArgument === 'function') { // mixin definition
    var cb = lastArgument;

    // make Mixin parameters from definition
    var args = [];
    for (var i = 1; i < arguments.length - 1; i++) {
      var param = arguments[i];
      var defaultValue = null;

      // check the default value [= mixin("name", "a=1", "b = 2", "c")]
      var m = param.match(/([^\=\s]*)\s*\=\s*(.*)/);
      if (m) {
        param = m[1];
        defaultValue = m[2];
      }

      args.push({
        name: param,
        value: defaultValue
      });
    }

    if (name) {
      this._mixins[name] = {
        arguments: args,
        body: cb
      };
      return '';
    }
    return '';
  }

  // mixin reference
  var referenceParams = [];
  for (var i = 1; i < arguments.length; i++) {
    referenceParams.push(arguments[i]);
  }

  // try to find mixin
  var mixin = null;
  for (var item in this._mixins) {
    // Check Mixin name
    if (item === name) {
      var maybeMixin = this._mixins[item];

      // check balance of arguments. If Mixin has free parameters without default values then skip this Mixin
      var paramsLength = maybeMixin.arguments.length;
      var mixinStatus = true;
      for (var i = referenceParams.length; i < maybeMixin.arguments.length; i++) {
        var param = maybeMixin.arguments[i];

        if (!param.value) {
          mixinStatus = false;
          break;
        }
      }

      if (mixinStatus) {
        mixin = maybeMixin;
        break;
      }
    }
  }

  if (!mixin) {
    return '';
  }

  // add default values
  var mixinParams = mixin.arguments;
  if (referenceParams.length !== mixinParams.length) {
    for (var i = referenceParams.length; i < mixinParams.length; i++) {
      if (mixinParams[i]) {
        referenceParams.push(mixinParams[i].value);
      }
    }
  }

  // convert Array to Object
  var params = {};
  for (var i = 0; i < referenceParams.length; i++) {
    params[mixinParams[i].name] = referenceParams[i];
  }

  // merge Mixin params with context
  if (this.m) {
    for (var item in this.m) {
      params[item] = this.m[item];
    }
  }

  return mixin.body.call(params);
}

module.exports = VM;
