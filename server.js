console.log('starting receiver');

var mode = process.env.mode;
var backendUrl = process.env.backendUrl;
var deviceUuid = process.env.RESIN_DEVICE_UUID;
var sleepStart = process.env.sleepStart;
var sleepEnd = process.env.sleepEnd;
var sleepStartInt = parseInt(sleepStart)
var sleepEndInt = parseInt(sleepEnd)

var macs = [];
var lastSent = {};
var readline = require('readline');
var _ = require('lodash');
var exec = require('child_process').exec;

var runCapturing = function(callback) {

  var concat = function(one, two) {
    return one + two;
  };

  var makeFilter = function(m) {
    return ' || wlan.sa == ' + m;
  };

  var macFilter;
  var filterCondition;
  console.log('running in mode ' + mode);
  if (mode && mode === 'explore') {
    filterCondition = '&& !';
  } else {
    filterCondition = '&& ';
  }
  macFilter = filterCondition + '(wlan.sa == ' + _.head(macs) + _.reduce(_.map(_.tail(macs), makeFilter), concat) + ')';
  var filter = mode == 'normal' ? ('wlan.fc.type == 0 && wlan.fc.subtype == 4 ' + macFilter) : 'wlan.fc.type == 0 && wlan.fc.subtype == 4 ';
  console.log('using filter: ' + filter);
  var spawn = require('child_process').spawn,
    ts = spawn("stdbuf", ["-oL", "-eL", 'tshark', '-i', 'mon0', '-f', 'broadcast', '-Y', filter, '-T', 'fields', '-e', 'frame.time_epoch', '-e', 'wlan.sa', '-e', 'radiotap.dbm_antsignal', '-e', 'wlan.sa_resolved', '-e', 'wlan_mgt.ssid']);


  readline.createInterface({
    input: ts.stdout,
    terminal: false
  }).on('line', function(line) {
    var a = line.toString().split("\t");
    var rssi = a[2].split(",");
    console.log('Device detected: ' + line);
    if (a[4]) {
      sendToBackand(a[0], a[1], rssi[0], a[4]);
    }
  });

  ts.stderr.on('data', function(data) {
    console.log('stderr: ' + data);
  });

  ts.on('exit', function(code) {
    console.log('child process exited with code ' + code);
    cleanUp(function(){
      exec('sudo airmon-ng start wlan0', function(error, stdout, stderr) {
        exec('sudo airmon-ng start wlan1', function(error, stdout, stderr) {
          if (!error) {
            console.log('putting device in monitor mode successful')
            runCapturing();
          }
        });
      });

    });
  });
}

var request = require('request');

var resolveMacsToFilter = function(callback) {
  // Configure the request
  var options = {
    url: backendUrl + '/people',
    method: 'GET'
  }

  // Start the request
  request(options, function(error, response, body) {
    if (!error && response.statusCode == 200) {
      var people = JSON.parse(body)._embedded.people;
      var devices = _.flatMap(people, function(p) {
        return _.filter(p.devices, function(d) {
          return d.enabled;
        });
      });

      // Print out the response body
      macs = _.map(devices, function(d) {
        return d.mac;
      });

      _(macs).forEach(function(m) {
        lastSent[m] = null;
      });

      callback();
    }
  })
}

var cleanUp = function(callback) {
    exec('sudo rm -r -f /tmp', function(error, stdout, stderr) {
      console.log(error)
      console.log(stdout)
      console.log(stderr)
      callback();
    });
  }
  // cleanUp(function() {
resolveMacsToFilter(function() {
  runCapturing()
});
// });


var sendToBackand = function(timestamp, mac, rssi, ssid) {
  var t = new Date();
  if (sleepStartInt != null && sleepEndInt != null) {

    var start = new Date()
    start.setHours(sleepStartInt)
    start.setMinutes(0)
    start.setSeconds(0)

    var end = new Date()
    end.setHours(sleepEndInt)
    end.setMinutes(0)
    end.setSeconds(0)
    if (end < start) {
      end.setDate(end.getDate() + 1)
    }

    var sleep = t >= start && t < end

  }

  if (!sleep) {
    t.setSeconds(t.getSeconds() - 300);
    var lastSentKey = mac + '-' + ssid;
    if (!lastSent[lastSentKey] || lastSent[lastSentKey] < t) {
      lastSent[lastSentKey] = new Date();
      request({
        url: backendUrl + '/signals',
        method: 'POST',

        json: {
          rssi: rssi,
          mac: mac,
          timestamp: new Date(),
          ssid: ssid,
          receiverUuid: deviceUuid
        }
      }, function(error, response, body) {
        if (error) {
          console.log(error);
        } else {
          console.log(response.statusCode, body);
        }
      });

    }
  } else {
    console.log('skipping - backend in sleep mode!');
  }


}
