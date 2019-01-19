const moment = require('moment'),      
      $ = require('./helpers.js'),
      math= require('mathjs');//http://mathjs.org/docs/core/extension.html;

// create a new data type
function Time(self, when) {
    if (when instanceof Time ){
        when = when.value.clone();
    } else if (when instanceof Date){
        when = moment(when);
    } else if (typeof when === 'string'){        
        when = moment(when, ['h:m a', 'H:m', 'h:m:s a', 'H:m:s', 'YYYY-MM-DD H:m:s', 'YYYY-MM-DD H:m','YYYY-MM-DD', 'YYYY-MM-DD h:m:s a', 'YYYY-MM-DD h:m a']);
    }
    this.sensor = self;
    this.value = when;
}
Time.prototype.isTime = true
Time.prototype.toString = function () {
    return this.value.format('LLLL')
}
Time.prototype.time = function(str){    
    return new Time(this.sensor, justTime(this.value));
}
Time.prototype.mo = function(){    
    return this.value.isoWeekday() == 1;
}
Time.prototype.tu = function(){    
    return this.value.isoWeekday() == 2;
}
Time.prototype.we = function(){    
    return this.value.isoWeekday() == 3;
}
Time.prototype.th = function(){    
    return this.value.isoWeekday() == 4;
}
Time.prototype.fr = function(){    
    return this.value.isoWeekday() == 5;
}
Time.prototype.sa = function(){    
    return this.value.isoWeekday() == 6;
}
Time.prototype.so = function(){    
    return this.value.isoWeekday() == 7;
}
Time.prototype.workday = function(){    
    return this.value.isoWeekday() < 6;
}
Time.prototype.weekend = function(){    
    return this.value.isoWeekday() >= 6;
}
Time.prototype.weekday = function(){    
    return this.value.isoWeekday();
}
Time.prototype.addMinutes = function(nr){    
    return new Time(this.sensor, this.value.clone().add(nr, 'minutes'));
}
Time.prototype.isHoliday = function (types) {
    return this.sensor.isHoliday(this.value.toDate(), types);    
}
Time.prototype.calendarMatch = function(regex){        
    return Sensor.matchesCalEventNow(this.value.toDate(), regex);
}
Time.prototype.isEvent = function(name){  
    const event = this.sensor.fetchEventAt(this.value.toDate());
    return $.EventTypes[event.event] == name;
}
  
// define a new datatype
math.typed.addType({
    name: 'Time',
    test: function (x) {
        return x && x.isTime
    }
})


// import in math.js, extend the existing function `add` with support for MyType
math.import({
    'smaller': math.typed('smaller', {
        'Time, Time': function (a, b) {
          return a.value < b.value;
        }
    }),
    'larger': math.typed('larger', {
        'Time, Time': function (a, b) {
          return a.value > b.value;
        }
    }),
    'equal': math.typed('equal', {
        'Time, Time': function (a, b) {
          return a.value.isSame(b.value, 'second');
        }
    }),
    'Time': function(self, str){
        return new Time(self, str);
    },
    'dailyrandom': function(self, nr, magnitude){        
        if (nr===undefined) nr = 0;
        if (magnitude===undefined) magnitude = 1;

        let rnd = self.dailyRandom[nr];
        if (rnd === undefined) {
            rnd = Math.random();
            self.dailyRandom[nr] = rnd;
        }

        return rnd * magnitude;
    },
})      

module.exports = function(sensor){
    const Sensor = sensor;
    
    return {
        Time:Time,
        compile : function(exp){
            return {
                expression : exp,
                code : math.compile(exp),
                run : function(constants, when){   
                    when = new Time(Sensor, when);
                    
                    const pos = Sensor.posForTime(when.value.toDate());
                    const newLux = Sensor.luxForTime(when.value.toDate(), pos);
                    const scope = {
                        self:Sensor,
                        altitude:pos.altitude,
                        altitudeDeg:pos.altitude*180/Math.PI,
                        azimuth:pos.azimuth,
                        azimuthDeg:pos.azimuth*180/Math.PI,
                        lux:newLux,
                        now:when,
                        btSwitch:{
                            when:new Time(Sensor, Sensor.bluetooth.lastEvent.when),
                            state:Sensor.bluetooth.lastEvent.state
                        },
                        ...constants
                    }
                    
                    const res = this.code.eval(scope);            
                    if (res.entries) {
                        return res.entries[0];
                    }
                    return res;
                },
                toString : function(){
                    return this.expression;
                }
            }
        }
    }
}
