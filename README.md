# homebridge-daily-sensors
This programable switch can be triggered based on userdefine rules related to time, daily events, calendar events, sun elevation
or amount of ambient light. Each TriggerEvent can be randomized to make sure that the rules trigger at slightly different times each day.

## Simple Configuration
The following configuration is based on the suns elevation (altitude) in London. If the sun rises above 3° the switch will be triggered (with a single press (<= `active:true`)). If the sun gets below 3° it triggers a double press
```json
  "accessories": [{
      "accessory": "DailySensors",
      "name":"My new daily switch",
      "dayStartsActive":false,    
      "trigger":[{
            "active":true,
            "type":"altitude",
            "value":"0.03",
            "trigger":"both"
      }],
      "location":{
        "longitude":-0.118092,
        "latitude":51.509865
      }
  }]
```

## How does it work?
The plugin calculates typical sun events as well as the suns elevation based on a given location. Each sensor has a given activation state at any given time of a day. Whenever the activation state changes, the Programmable switch is notified. If the state changes from **off to on**, a **single press** is sent. if it changes from **on to off** a **double press** is generated. The activation state is determined through an array of TriggerEvents.

All TriggerEvent are stored in the `trigger:array` config variable. Each TriggerEvent has the following basic properties:
- `type` : The type of the TriggerEvent (`time`, `altitude`, `lux` `calendar`, `expression` or `event`). 
- `value` : A given treshold that is compared 
- `active` : The new activation state of the sensor if the TriggerEvent is triggered 

The sensor receives a tick event in a certain interval (config variable `tickTimer:seconds`). At every tick, all TriggerEvents are evaluated in sequence and the state of the sensor is determined (active/deactive) like this:s
- First the activation state is set to the state defined in `dayStartsActive:bool`.
- Each TriggerEvent (config variable `trigger:array`) is evaluated in the given sequence. 
- If a TriggerEvent is triggered, the activation state is recalculated. Normaly a TriggerEvent is triggered when the current value (like the current time) is greater than the specified `value` of the TriggerEvent and the activation state is set as was defined in the TriggerEvents' `active:bool` config variable. Take for exampl ethe following TriggerEvents:
```json
    "dayStartsActive":false,    
    "trigger":[{
        "active":true,
        "type":"time",
        "value":"10:00 AM"
    },{
        "active":false,
        "type":"time",
        "value":"1:00 PM"
    }]
```

Evaluating the sensor at `11:00 PM` yields the following sequence: The evaluation starts with the activation state set to `false` (`"dayStartsActive":false`). Now the first TriggerEvent is calculated. Since `11:00 AM` (the current time) is larger than `10:00 AM` (the `"value":"10:00 AM"` of the TriggerEvent), the event is triggered and sets the activation state to `true`. The second TriggerEvent does not trigger as its value (`1:00 PM`) is less than the current time. The resulting activation state for `11:00 PM` is `true`.

Evaluating the same set of TriggerEvents at `2:00 PM`generates a different activation state. As above, the evaluation starts with the activation state set to `false`. The first TriggerEvent will trigger as before and changes the activation state to `true`. However, the second TriggerEvent will also trigger and finally change the activation state back to `false`. Hence, the resulting activation state for `11:00 PM` is `true`.

In this case the switch will be notified twice a day: 
- At `10:00 AM` when the activation state first changes from `false` to `true`resulting in a **single press**
- At `1:00 PM` when the activation state changes back to `false`resulting in a **double press**

## Calendar Connection
You can connect a caldav ready calendar (like iCloud, see https://community.openhab.org/t/solved-apple-icloud-caldav-connection/32510/6 to find the url, username and password to access an iCloud calendar) and use calendar events as triggers. The following config file will connect to the iCloud-calendar **https://pxx-caldav.icloud.com/xxxxxx/calendars/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx/** with the user name **someone@me.com** and the application password **application-password**:

```json
  "accessories": [{
      "accessory": "DailySensors",
      "name":"TheDaily",
      "port":7755,
      "dayStartsActive":false,
      "calendar":{
        "url":"https://pxx-caldav.icloud.com/xxxxxx/calendars/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx/",
        "username":"someone@me.com",
        "password":"application-password",
        "type":"caldav"
      },    
      "trigger":[{
        "active":true,
        "type":"calendar",
        "value":"^Urlaub$",
        "trigger":"both"        
      }],
      "location":{
        "longitude":-0.118092,
        "latitude":51.509865
      }
  }]
```

The activation state changes to `true` whenever an Event named **Urlaub** starts and to `false` whenever it ends.

## Web Service
The plugin offers a very simple web interface to force trigger the switch, check and reset the state as well as visualize the activation state of the switch over the day. This is a helpfull tool when debuging a given sequence of TriggerEvents. If you specify a config variable `port`, a web server will be started and bound. The index page (see below) will display an overview of available Accesories.

### Configuration 
For example, when using the follwoing config
```json
  "accessories": [{
      "accessory": "DailySensors",
      "name":"TheDaily",
      "port":7755,
      "dayStartsActive":false,    
      "trigger":[{
            "active":true,
            "type":"altitude",
            "value":"0.03",
            "trigger":"both"
      }],
      "location":{
        "longitude":-0.118092,
        "latitude":51.509865
      }
  }]
```
you may access the web interface through http://[homebridge-ip]:7755/thedaily/. Note that the lowercase name of the accessory is part of the URI. If your name contains non ASCII characters, you may want to specify the path for URL using the `webPath` variable. Having a config like this:

```json
  "accessories": [{
      "accessory": "DailySensors",
      "name":"My very special Sensor Name",
      "webPath":"/thedaily/me",
      "port":7755,
      //...
```
will for example start the webservice on the base URL http://[homebridge-ip]:7755/thedaily/me/. Also note that you can have multiple DailySensors on the same port. 

### Index Page
To receive an overview of the available sensors on a given port you can open http://[homebridge-ip]:7755/. For a setup with tow configured accesories on the same port this will yield the following result:

![The Main Index Screen](/support/index.png)

### Visualize TriggerEvents
If you open the root resource of an accesory (http://[homebridge-ip]:7755/thedaily/) the system will display the activation state of the sensor over the course of the entire day as well as display the results of the Evaluation steps for every minute of the day.

![The Activation Info Screen](/support/info.png)

### Force a state change
If you access http://[homebridge-ip]:7755/thedaily/1 (or http://[homebridge-ip]:7755/thedaily/0) the switch is triggered with an **on** (**off**) event resulting in a **single press** (**double press**) notification. This locks the state of the switch to the given value until a activation state changes based on the defined rules.

### Clear forced state
If you force a state change as described above, you can restore the normal operation of the switch using  http://[homebridge-ip]:7755/thedaily/clear

### Query state
You can also query the current state of the switch using http://[homebridge-ip]:7755/thedaily/state

### Force reload
Some information is updated once a day (like calendar events). You can force a update of those events using http://[homebridge-ip]:7755/thedaily/reload.


## Config Options
There are some additional config variables available:
- `tickTimer:milliSeconds`:  The interval at wich the Activation State is evaluated (defaults to 30s, `"tickTimer":30000`).
- `debug:bool`: Wether you want to log some additional debug information (warning: this will generate a lot of output, defaults to false, `"debug":false`)
- `locale:string`: The local used to parse date/time related values (like weekdays, defaults to english, `"locale":"en"`)

### Advanced TriggerEvents
Each TriggerEvent can have additional settings that alter its behaviour.

#### Randomize
Some TriggerEvent-Types can be randomized using the `random` setting. When this value is non zero, it is used to alter the given TriggerEvent value every day. When using `random` in a time based trigger, you can specify the amount of minutes added (or subtracted) at max from the value every day. The following example will generate times from **6:50 am** to **7:10 am**:
```json
    "trigger":[{
        "active":true,
        "type":"time",
        "value":"7:00 AM",
        "random":10
    }]
```

See the type descriptions below for additional information on the behaviour of random for every type.

#### Operations
The operation controls how the activation state of the triggered TriggerEvent is applied to the result of the previous TriggerEvent. The behaviour is configured using the `op`-value. We will use the following trigger sequence as an example in the descriptions below. 
```json
    "dayStartsActive":false,    
    "trigger":[{
        "active":true,
        "type":"time",
        "value":"10:00 AM"
    }]
```

The following values are recognized:
- `set` : The default behaviour. When the event is triggered the activation state is set to the specified value. 
- `and` : A logical **and** is used to calculate the new activation state. Evaluating the sensor at `11:00 PM` yields the following sequence: The evaluation starts with the activation state set to `false` (`"dayStartsActive":false`). Now the first TriggerEvent is calculated. Since `11:00 AM` (the current time) is larger than `10:00 AM` (the `"value":"10:00 AM"` of the TriggerEvent), the event is triggered. Since `false` (the current state) **and** `true` (the value of the TriggerEvent) results in `false` the activation state remains `false`.
- `or` : A logical **or** is used to calculate the new activation state. Evaluating the sensor at `11:00 PM` yields the following sequence: The evaluation starts with the activation state set to `false` (`"dayStartsActive":false`). Now the first TriggerEvent is calculated. Since `11:00 AM` (the current time) is larger than `10:00 AM` (the `"value":"10:00 AM"` of the TriggerEvent), the event is triggered. Since `false` (the current state) **or** `true` (the value of the TriggerEvent) results in `true` the activation state is change to `true`.
- `discard` : The TriggerEvent is ignored.

#### Trigger Condition
By default an EventTrigger is triggered when the current value (like the current time) is greater than the specified value. Only a triggered event can alter the activation state. Using the `trigger` parameter, allows you to specify a different behaviour. The following values are possible:

- `greater` : The default behaviour.
- `less` : The Event is triggered when the current value is less than the specified one. When the event triggers before the actual value, the `active`-value is negated. The following Event will only trigger before **2:00 pm** and will set the activation state to `false` (since `"active":true` is negated):
```json
    "trigger":[{
        "active":true,
        "type":"time",
        "value":"2:00 PM",
        "trigger":"less"
    }]
```
- `both` : The event is allways triggered. When the event triggers before the actual value, the `active`-value is negated. When the following Event is triggered **before 2:00 pm** the activation state changes to `false` when it is triggered **after 2:00 pm** the activation state changes to `true`.
```json
    "trigger":[{
        "active":true,
        "type":"time",
        "value":"2:00 PM",
        "trigger":"both"
    }]
```

#### Days Of Week
The `daysOfWeek`-value contains an array of weekdays (in the specified locale). The event can only trigger on days listed in this array. For example, the following TriggerEvent is only triggered on **Weekends** after **10:00 am**.
```json
    "trigger":[{
        "active":true,
        "type":"time",
        "value":"10:00 AM",
        "daysOfWeek":["sa", "so"]
    }]
```

#### Types
The following settings are available for the given TriggerEvent-Types.

##### Time
- `type` : `time`
- `value` :
- `random` :

##### Altitude
- `type` : `altitude`
- `value` :
- `random` :

##### Lux
- `type` : `lux`
- `value` :
- `random` :

##### Event
- `type` : `event`
- `value` : one of the following event types `nightEnd`, `nauticalDawn`, `dawn`, `sunrise`, `sunriseEnd`, `goldenHourEnd`, `solarNoon`, `goldenHour`, `sunsetStart`, `sunset`, `dusk`, `nauticalDusk`, `night`, `nadir`
- `trigger` : 

##### Calendar Event
- `type` : `calendar`
- `value` : A JavaScript RegExp. `Hello` will match any Event that contains the Word **Hello** (ie. 'Hello World', 'My Beautiful Hello', 'Hello'). `^Hello$` will only match Events where the summary is the Word **Hello** ('Hello World' and 'My Beautiful Hello' do not match).
- `trigger` : 

##### Expression
This type allows you to write a logical expression to determinthe activation state. The underlying parser is [Math.js](http://mathjs.org/docs/core/extension.html) with a few custom extensions to handle some time and calendar based events.

- `type` : `expression`
- `value` : An logical expresion. You may use all functions available in [Math.js](http://mathjs.org/docs/core/extension.html), as well as the following expressions
  - Functions
    - `dailyrandom(nr, magnitude)` : creates a random value with index `nr` that is maintained for the entire day. You can use this to generate multiple random numbers for your expressions that do not change with each evaluation of the expression on the same day. The random value is generated between 0 (included) and `magnitude` (excluded).
    - `dailyrandom(nr)` : same as `dailyrandom(nr, 1)`
    - `dailyrandom()` : same as `dailyrandom(0, 1)`
    - `Time("str")` : creates a date-object. Valid String Formats are `h:m a`, `H:m`, `h:m:s a`, `H:m:s`, `YYYY-MM-DD H:m:s`, `YYYY-MM-DD H:m`,`YYYY-MM-DD`, `YYYY-MM-DD h:m:s a`, `YYYY-MM-DD h:m a`. Time Values can be compared using `<`, `>` and `==`. Two date Values are equal if they match up to the second. In the following `t` represents a Time-constant.
    - `t.mo()` : `true` if the represented date is a monday.
    - `t.tu()` : `true` if the represented date is a tuesday.
    - `t.we()` : `true` if the represented date is a wednesday.
    - `t.th()` : `true` if the represented date is a thursday.
    - `t.fr()` : `true` if the represented date is a friday.
    - `t.sa()` : `true` if the represented date is a saturday.
    - `t.so()` : `true` if the represented date is a sunday.
    - `t.workday()` : `true` if the represented date is a mo through fr.
    - `t.weekend()` : `true` if the represented date is sa or so.
    - `t.weekday()` : returns a number that represents a ISO-weekday (mo=1, tu=2, ...)
    - `t.time()` : returns just the time of the date
    - `t.addMinutes(nr)` : adds `nr`-minutes to `t` and returns the new date.
    - `events.isHoliday(Time)` : returns true if the date is a **public** or **bank** holiday. We use [date-holiday](https://www.npmjs.com/package/date-holidays) to check for holidays.
    - `events.isHoliday(Time, [types])` : returns true if the date holiday and the type of that holiday (see [date-holiday](https://www.npmjs.com/package/date-holidays#types-of-holidays) ) is contained in the passed types-Array.
  - Constants
    - `altitude` : The current elevation of the sun in radians
    - `altitudeDeg` : The current elevation of the sun in degrees
    - `lux` : The current brightness
    - `now` : The current time and date
    

