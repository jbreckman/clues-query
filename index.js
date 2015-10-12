var sift = require('sift'),
    clues = require('clues'),
    Promise = clues.Promise;

// Polyfill for Object.setPrototypeOf
Object.setPrototypeOf = Object.setPrototypeOf || function(obj, proto) {
  obj.__proto__ = proto;
  return obj; 
};

// WARNING Sift exposes access to javascript through $where
// Here we override $where with an error
sift.useOperator('where',function() { throw 'NOT_ALLOWED';});

// Helper functions
function toDots(d) { return d.replace(/ᐉ/g,'.'); }
function noop() {}

// This is the main prototype 
var Query = Object.create(Array.prototype);

// Pick returns a filtered subset of the records
Query.pick = function(_filters) {
  var self = this;
  return function $property(ref) {
  
    // Provide pipe delimited filtering
    ref = ref.split('|').sort();
    if (ref.length > 1)
      // Solve for the first one, and then the remainder
      return [ref[0],function(q) {
        return [{q:q},'q.pick.'+ref.slice(1).join('|'),Object];
      }];
    
    ref = ref[0];

    ref = ref.split('=');

    var filter = {};
    if (ref.length == 2)
      filter[toDots(ref[0])] = ref[1];
    else
      filter = _filters && _filters[ref[0]];

    if (!filter)
      throw {message:'INVALID_FILTER',filter:ref};

    return Object.setPrototypeOf(sift(filter,self),Query);
  };
};

Query.select = function($global) {
  var self = this;
  return function $property(ref) {
    ref = ref.split('|').map(toDots);
    return Promise.map(self.slice(),function(d) {
      return Promise.reduce(ref,function(p,field) {
        var key;
        field = field.split('=');
        key = field[1] || field[0];
        field = field[0];
        return clues(d,field,$global)
          .catch(noop)
          .then(function(d) {
            if (ref.length > 1) 
              p[key] = d;
            else
              return d;
            return p;
          });
      },{});
    })
    .then(function(d) {
      return Object.setPrototypeOf(d,Query);
    });        
  };
};

Query.expand = function($global) {
  return Promise.map(this.slice(),function(d) {
    for (var key in d) {
      if (d[key] && (typeof d[key] === 'function' || (d[key].length && typeof d[key][d[key].length-1] === 'function') || d[key].then))
        d[key] = clues(d,key,$global);
    }
    return Promise.props(d);
  })
  .then(function(d) {
    return Object.setPrototypeOf(d,Query);
  });
};

Query.reversed = function() {
  return Object.setPrototypeOf(this.slice().reverse(),Query);
};

Query.ascending = function $property(ref) {
  var obj = Object.setPrototypeOf(this.slice(),Object.getPrototypeOf(this));
  return [{q:this},'q.select.'+ref,function(keys) {
    obj.forEach(function(d,i) {
      d.sortkey = keys[i];
    });
    obj = obj.sort(function(a,b) {
      return a.sortkey - b.sortkey;
    });
    return Object.setPrototypeOf(obj,Query);
  }];
};

Query.descending = function $property(ref) {
  return [{q:this},'q.ascending.'+ref,function(ascending) {
    return Object.setPrototypeOf(ascending.slice().reverse(),Query);
  }];
};

Query.stats = function($global) {
  return function $property(ref) {
    return this.select($global)(ref)
      .then(function(d) {
        var obj = d.reduce(function(p,d) {
          d = Number(d);
          p.sum += d;
          p.cumul.push(p.sum);
          p.min = Math.min(p.min,d);
          p.max = Math.max(p.max,d);
          return p;
        },{
          sum : 0,
          cumul : [],
          min : Infinity,
          max : -Infinity
        });
        obj.count = d.length;
        obj.avg = obj.sum / obj.count;
        return obj;
      });
  };
};


Query.group_by = function($global,$fullref,$caller,_rank) {
  return function $property(field) {
    var obj = {};
    return Promise.map(this.slice(),function(d) {
      return clues(d,field,$global,$caller,$fullref)
        .then(function(v) {
          (obj[v] || (obj[v] = Object.setPrototypeOf([],Query))).push(d);
        });
    })
    .then(function() {
      if (!_rank) 
        return;

      // Reorder into new object
      var o = {};
      [].concat(_rank).forEach(function(key) {
        if (obj[key]) {
          o[key] = obj[key];
          delete obj[key];
        }
      });
      for (var key in obj)
        o[key] = obj[key];
      obj = o;
    })
    .then(function() {
      var groups = Object.keys(obj);
      var $external = function(ref) {
        return Promise.props(groups.reduce(function(p,key) {
          //console.log('solving for',Obj[key],Obj[key].pick,ref)
          p[key] = clues(obj[key],ref,$global,$caller,$fullref).catch(noop);
          return p;
        },[]));
      };
      Object.defineProperty(obj,'$external',{value:$external});
      return obj;
    });
  };
};

Object.defineProperty(Query,'rank',{
  value : ['input.rank',Object]
});

Object.defineProperty(Query,'filters',{
  value : ['input.filters',Object]
});


module.exports = Query;