function DispatchNode() {
  this.method = null;
  this.children = {};
}

DispatchNode.prototype.compile = function(level, callMethod) {

  if (this.method) {
    callMethod = 'this.' + this.method + '(exps)';
  }

  var code = 'switch(exps[' + level + ']) {';
  var empty = true;

  for(var key in this.children) {
    empty = false;
    code += "\ncase '" + key +"':\n";
    code +=  this.children[key].compile(level + 1, callMethod) + ';';
  }

  if (empty) {
    return 'return ' + callMethod;
  }

  code += '\ndefault:\nreturn ' + (callMethod || 'exps') + ';\n}';

  return code;
};

function Dispatcher() {
  this.methodSplitRE = /_/;
  this.methodRE = /^on(_[a-zA-Z0-9]+)*$/;
};

(function() {
  // Dispatching

  this.exec = function(exp) {
    return this.compile(exp);
  };

  this.compile = function(exp) {
    return this.dispatcher(exp);
  };

  this.dispatcher = function(exp) {
    return this.replaceDispatcher(exp);
  };

  this.dispatchedMethods = function() {
    var res = [];

    for (var key in this) {
      if (this.methodRE.test(key)) {
        res.push(key);
      }
    }
    return res;
  };

  this.replaceDispatcher = function(exp) {
    var tree = new DispatchNode;
    var dispatchedMethods = this.dispatchedMethods();
    for (var i = 0, method; method = dispatchedMethods[i]; i++) {
      var types = method.split(this.methodSplitRE);
      var node = tree;
      for (var j = 1, type; type = types[j]; j++) {
        var n = node.children[type];
        node = node.children[type] = n || new DispatchNode;
      }
      node.method = method;
    }
    var code = '[function(exps) {' + tree.compile(0) + '}]';
    this.dispatcher = eval(code)[0];
    return this.dispatcher(exp);
  };
}).call(Dispatcher.prototype);

module.exports = Dispatcher;