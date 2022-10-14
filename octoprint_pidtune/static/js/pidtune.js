/*
 * View model for OctoPrint-Pidtune
 *
 * Author: Tom Haraldseid
 * License: AGPLv3
 */


$(function() {

    function PidtuneViewModel(parameters) {
        var self = this;

        self.loginState = parameters[0];
        self.settingsViewModel = parameters[1];
        self.temperature_cutoff = self.settingsViewModel.temperature_cutoff;
        self.max_temp = 0;
        self.isErrorOrClosed = ko.observable(undefined);
        self.isOperational = ko.observable(undefined);
        self.isPrinting = ko.observable(undefined);
        self.isPaused = ko.observable(undefined);
        self.isError = ko.observable(undefined);
        self.isReady = ko.observable(undefined);
        self.isLoading = ko.observable(undefined);
        
        self.max_plot = 100;
        self.actTemp = [];
        self.targetTemp = [];
        self.selectedController = ko.observable("Tool0") 
        self.tempControllers = ko.observableArray(["Tool0", "Tool1", "Bed"])
        
        self.pidData = {};
        
        self.pidData.bias = ko.observable("-");
        self.pidData.min = ko.observable("-");
        self.pidData.max = ko.observable("-");
        self.pidData.ku = ko.observable("40");
        self.pidData.tu = ko.observable("20");
        self.pidData.kp = ko.observable("0");
        self.pidData.ki = ko.observable("0");
        self.pidData.kd = ko.observable("0");
        self.pidData.ti = ko.observable("0");
        self.pidData.td = ko.observable("0");
        self.pidData.model = ko.observable("cl")
        
        self.target = ko.observable("200");
        self.cycles = ko.observable("8");
        self.stepSize = ko.observable("10");
        self.fanSpeed = [];
        self.currFanSpeed = 0;
        self.pidAutoState = ko.observable("Ready");
        
        self._printerProfileUpdated = function() {
            var tempArray = [];
            // tools
            var numExtruders = self.settingsViewModel.printerProfiles.currentProfileData().extruder.count();
            if (numExtruders) {
                for (var extruder = 0; extruder < numExtruders; extruder++) {
                   tempArray.push('Tool' + extruder);
                }
            }
            // print bed
            if (self.settingsViewModel.printerProfiles.currentProfileData().heatedBed()) {
                tempArray.push('Bed');
            }
            self.tempControllers(tempArray);
            self.actTemp = [];
            self.targetTemp = [];
            self.fanSpeed = [];
            for(var i =0;i<tempArray.length;i++){
                self.actTemp.push([]);
                self.targetTemp.push([]);
            }
        };
        
        self.settingsViewModel.printerProfiles.currentProfileData.subscribe(function() {
            self._printerProfileUpdated();
            self.settingsViewModel.printerProfiles.currentProfileData().extruder.count.subscribe(self._printerProfileUpdated);
            self.settingsViewModel.printerProfiles.currentProfileData().heatedBed.subscribe(self._printerProfileUpdated());
        });
        
        self.updatePidDataK = function(newValue) {
        	self.pidData.kp(self.pidData.kpCo());
        	self.pidData.ki(self.pidData.kiCo());
        	self.pidData.kd(self.pidData.kdCo());
        };
        
        self.updatePidDataT = function(newValue) {
        	self.pidData.ti(self.pidData.tiCo());
        	self.pidData.td(self.pidData.tdCo());
        };
        
        self.pidData.kpCo = ko.computed(function() {
        	switch (self.pidData.model()) {
        	
        	case "cl":
        		return 0.6 * parseFloat(self.pidData.ku())        		
        		break;
        	case "pe":
        		return 0.7 * parseFloat(self.pidData.ku()) 
        		break;
        	case "so":
        		return 0.33 * parseFloat(self.pidData.ku()) 
        		break;
        	case "no":
        		return 0.2 * parseFloat(self.pidData.ku()) 
        		break;
        	}
        });
        
        self.pidData.kiCo = ko.computed(function() {
        	switch (self.pidData.model()) {
        	
        	case "cl":
        	case "so":
        	case "no":
        		return 2.0 * parseFloat(self.pidData.kp()) / parseFloat(self.pidData.tu())     		
        		break;
        	case "pe":
        		return 2.5 * parseFloat(self.pidData.kp()) / parseFloat(self.pidData.tu()) 
        		break;
        	}
        });
        
        self.pidData.kdCo = ko.computed(function() {
        	switch (self.pidData.model()) {
        	
        	case "cl":
        		return parseFloat(self.pidData.kp()) * parseFloat(self.pidData.tu()) / 8.0   		
        		break;
        	case "pe":
        		return 3.0 * parseFloat(self.pidData.kp()) * parseFloat(self.pidData.tu()) / 20.0
        		break;
        	case "so":
        	case "no":
        		return parseFloat(self.pidData.kp()) * parseFloat(self.pidData.tu()) / 3.0
        		break;
        	}
        });
        
        self.pidData.tiCo = ko.computed(function() {
        	return parseFloat(self.pidData.kp()) / parseFloat(self.pidData.ki())
        	//
        });
        
        self.pidData.tdCo = ko.computed(function() {
        	return parseFloat(self.pidData.kd()) / parseFloat(self.pidData.kp())
        	//
        });
        
        self.pidData.tu.subscribe(self.updatePidDataK);
        self.pidData.ku.subscribe(self.updatePidDataK);
        self.pidData.model.subscribe(self.updatePidDataK);
        self.pidData.kp.subscribe(self.updatePidDataT);
        self.pidData.ki.subscribe(self.updatePidDataT);
        self.pidData.kd.subscribe(self.updatePidDataT);
        self.pidData.ti.subscribe(function(newValue) {self.pidData.ki(self.pidData.kp() / newValue)});
        self.pidData.td.subscribe(function(newValue) {self.pidData.kd(self.pidData.kp() * newValue)});

        self.setControls = function(state) {
            if (self.stateControls != state) {
                self.stateControls = state;
                $('#btnApply').prop('disabled', !state);
                $('#btnSave').prop('disabled', !state);
                $('#btnRestore').prop('disabled', !state);
                $('#btnBackup').prop('disabled', !state);
                $('#btnCurrent').prop('disabled', !state);
            }
        };

        self.autoBtn = function() {
        	if (self.selectedController().slice(0,4) == 'Tool') {
        			self.sendCommand("M303 E" + self.selectedController().slice(4,5) + " S" + self.target() + " C" + self.cycles());
        	}else if (self.selectedController() == 'Bed') {
        			self.sendCommand("M303 E-1 S" + self.target() + " C" + self.cycles());
        	}
        	$('#btnSave').removeClass("btn-primary");
			$('#btnApply').removeClass("btn-primary");
        	self.pidAutoState("Running");
        };
        
        self.manualBtn = function() {
        	if (self.selectedController().slice(0,4) == 'Tool') {
        			self.sendCommand("M104 T" + self.selectedController().slice(4,5) + " S" + self.target());
        	}else if (self.selectedController() == 'Bed') {
        			self.sendCommand("M140 S" + self.target());
        	}
        };
        
        self.incBtn = function() {
        	var newTarget = parseFloat(self.currentTargetTemp) + parseFloat(self.stepSize());
        	
        	if (self.selectedController().slice(0,4) == 'Tool') {
        			self.sendCommand("M104 T" + self.selectedController().slice(4,5) + " S" + newTarget);
        	}else if (self.selectedController() == 'Bed') {
        			self.sendCommand("M140 S" + newTarget);
        	}
        };
        
        self.decBtn = function() {
        	var newTarget = parseFloat(self.currentTargetTemp) - parseFloat(self.stepSize());
        	
        	if (self.selectedController().slice(0,4) == 'Tool') {
        			self.sendCommand("M104 T" + self.selectedController().slice(4,5) + " S" + newTarget);
        	}else if (self.selectedController() == 'Bed') {
        			self.sendCommand("M140 S" + newTarget);
        	}
        };
        
        self.offBtn = function() {
        	if (self.selectedController().slice(0,4) == 'Tool') {
        			self.sendCommand("M104 T" + self.selectedController().slice(4,5) + " S0");
        	}else if (self.selectedController() == 'Bed') {
        			self.sendCommand("M140 S0");
        	}
        };
        
        self.applyBtn = function() {
        	if (self.selectedController().slice(0,4) == 'Tool') {
        			self.sendCommand("M301 E" + self.selectedController().slice(4,5) + " P" + $('#Kp').val() + " I" + $('#Ki').val() + " D" + $('#Kd').val());
        	}else if (self.selectedController() == 'Bed') {
        			self.sendCommand("M304 P" + self.pidData.kp() + " I" + self.pidData.ki() + " D" + self.pidData.kd());
        	}
        	$('#btnApply').removeClass("btn-primary");
        	$('#btnSave').addClass("btn-primary");
        };

		self.saveBtn = function() {
			self.sendCommand("M500");
		    $('#btnSave').removeClass("btn-primary");
		};
		
		self.currentBtn = function() {
			$('#btnSave').removeClass("btn-primary");
			$('#btnApply').removeClass("btn-primary");
			if (self.selectedController().slice(0,4) == 'Tool') {
        			self.sendCommand("M301 E" + self.selectedController().slice(4,5));
        			
        	}else if (self.selectedController() == 'Bed') {
        			self.sendCommand("M304");
        			
        	}
		};
        
        self.fromCurrentData = function(data) {
        	try {
				self._processStateData(data.state);
				}
        	catch (exc) {}
        	try {
				self._processTempData(data.serverTime, data.temps);
        	}
			catch (exc) {}
            try {
				self._processLogsData(data.logs)
            }
            catch (exc) {}
            try {
				self.updatePlot();
            }
            catch (exc) {}
        };//.bind(self);

        self._processTempData = function (serverTime, data) {
        	var clientTime = Date.now();
        	var temperature_cutoff = self.temperature_cutoff();
        	for (var i = 0; i < data.length; i++) {
        		var timeDiff = (serverTime - data[i].time) * 1000;
                var time = clientTime - timeDiff;
        		for(var j = 0; j < self.tempControllers().length; j++){
        		    var objActual = [time, parseFloat(data[i][self.tempControllers()[j].toLowerCase()].actual)];
        		    var objTarget = [time, parseFloat(data[i][self.tempControllers()[j].toLowerCase()].target)];
        		    self.max_temp = updateMaxTemp(objActual[1]+10,self.max_temp);
        		    self.max_temp = updateMaxTemp(objTarget[1]+10,self.max_temp);
        		    if(self.actTemp[j].length > 0){
                        if(self.actTemp[j][0][0] <  temperature_cutoff * 60 * 1000){
                            self.actTemp[j].shift();
                        }
        		    }

        		    /*if(self.actTemp[j].length >= self.max_plot){
        			    self.actTemp[j].shift();
        		    }*/
        		    if(self.targetTemp[j].length > 0){
                        if(self.targetTemp[j][0][0] <  temperature_cutoff * 60 * 1000){
                            self.targetTemp[j].shift();
                        }
        		    }
        		    /*if(self.targetTemp[j].length >= self.max_plot){
        			    self.targetTemp[j].shift();
        		    }*/
        		    self.actTemp[j].push(objActual);
        		    self.targetTemp[j].push(objTarget);
        		}
                /*var objActual = [time, parseFloat(data[i][self.selectedController().toLowerCase()].actual)];
        		var objTarget = [time, parseFloat(data[i][self.selectedController().toLowerCase()].target)];*/
                if(self.fanSpeed.length > 0){
                    if(self.fanSpeed[0][0] <  temperature_cutoff * 60 * 1000){
                        self.fanSpeed.shift();
                    }
                }
        		/*if(self.fanSpeed.length >= self.max_plot){
        			self.fanSpeed.shift();
        		}*/

        		var currFanSpeedObj = [time, self.currFanSpeed];
        		self.fanSpeed.push(currFanSpeedObj);

        	}
        }.bind(self);
        
        self._processLogsData = function (data) {
        	//console.log(data);
        	var rePid = /^Recv:\s+echo:\s+(?:e:\d+\s+)?p:(\d+\.?\d*)\s+i:(\d+\.?\d*)\s+d:(\d+\.?\d*).*/;
            var reToolPid = /^Recv:\s+echo:\s+M301\s+P(\d+\.?\d*)\s+I(\d+\.?\d*)\s+D(\d+\.?\d*).*/;
            var reBedlPid = /^Recv:\s+echo:\s+M304\s+P(\d+\.?\d*)\s+I(\d+\.?\d*)\s+D(\d+\.?\d*).*/;
            var reTuneStat = /^Recv:\s+bias:\s*(\d+\.?\d*)\s+d:\s*(\d+\.?\d*)\s+min:\s*(\d+\.?\d*)\s+max:\s*(\d+\.?\d*).*/;
            var reTuneParam = /^Recv:.+Ku:\s*(\d+\.?\d*)\s+Tu:\s*(\d+\.?\d*).*/;
            var reTuneComplete = /^Recv:\s+PID Autotune finished.*/;
            var reTuneFailed = /^Recv:\s+PID Autotune failed.*/;
            var reFanSpeed = /^Recv:\s+Fan\(s\)\s+Speed:\s+Fan0=([0-9]+).*/;

            for (var i = 0; i < data.length; i++) {
            	
            	var logsMatch = data[i].match(reTuneStat);
            	
            	if (logsMatch != null) {
            		self.pidData.bias(logsMatch[1]);
            		self.pidData.min(logsMatch[3]);
            		self.pidData.max(logsMatch[4]);
            	}
            	
            	logsMatch = data[i].match(reTuneParam);
            	
            	if (logsMatch != null) {
            		self.pidData.ku(logsMatch[1]);
            		self.pidData.tu(logsMatch[2]);
            	}
            	
            	logsMatch = data[i].match(reTuneComplete);
            	if (logsMatch != null) {
            		self.pidAutoState("Completed");
            		$('#btnApply').addClass("btn-primary");
            	}
            	
            	logsMatch = data[i].match(reTuneFailed);
            	if (logsMatch != null) {
            		self.pidAutoState("Failed");
            	}
            	
            	if (self.selectedController() == "Bed") {
            		logsMatch = data[i].match(reBedlPid);
                	
                	if (logsMatch != null) {
                		self.pidData.kp(logsMatch[1]);
                		self.pidData.ki(logsMatch[2]);
                		self.pidData.kd(logsMatch[3]);
                	}
            	}else{
            		logsMatch = data[i].match(reToolPid);
                	
                	if (logsMatch != null) {
                		self.pidData.kp(logsMatch[1]);
                		self.pidData.ki(logsMatch[2]);
                		self.pidData.kd(logsMatch[3]);
                	}
            		
            	}
            	
            	logsMatch = data[i].match(rePid);
            	if (logsMatch != null) {
            		self.pidData.kp(logsMatch[1]);
            		self.pidData.ki(logsMatch[2]);
            		self.pidData.kd(logsMatch[3]);
            	}

            	logsMatch = data[i].match(reFanSpeed);

            	if (logsMatch != null) {
                    var clientTime = Date.now();
                    self.currFanSpeed = formatFanSpeedVal(parseInt(logsMatch[1]),true);
                    var currFanSpeedObj = [clientTime, self.currFanSpeed];
                    //self.actTemp.push([clientTime,self.actTemp[self.actTemp.length - 1][1]]);

            		//self.targetTemp.push([clientTime,self.targetTemp[self.targetTemp.length - 1][1]]);
            		self.fanSpeed.push(currFanSpeedObj);
            	}
        	}
            
        }.bind(self);
        self.showPluginConfig = function(){
        return true;
        };
        self._processStateData = function (data) {
            self.isErrorOrClosed(data.flags.closedOrError);
            self.isOperational(data.flags.operational);
            self.isPaused(data.flags.paused);
            self.isPrinting(data.flags.printing);
            self.isError(data.flags.error);
            self.isReady(data.flags.ready);
            self.isLoading(data.flags.loading);
        };
        self.resetAdvgraph = function(){
            self._printerProfileUpdated();
            var plt = $.plot("#pidtune-graph", [], self.pidPlotOptions());
            plt.destroy();
            console.log("reset");
        };

        self.pidPlotOptions = function(cols){
                return ({
                         yaxis: {
                            min: 0,
                            max: self.max_temp,
                            ticks: 8
                         },
                         xaxis: {
                            mode: "time",
                            type: 'scatter',
                            minTickSize: [1, "minute"],
                            tickFormatter: function(val, axis) {
                                if (val == undefined || val == 0)
                                    return ""; // we don't want to display the minutes since the epoch if not connected yet ;)

                                // current time in milliseconds in UTC
                                var timestampUtc = Date.now();

                                // calculate difference in milliseconds
                                var diff = timestampUtc - val;

                                // convert to minutes
                                var diffInMins = Math.round(diff / (60 * 1000));
                                if (diffInMins == 0)
                                    return gettext("just now");
                                else
                                    return "- " + diffInMins + " " + gettext("min");
                            }
                         },
                         legend: {
                            position: "nw",
                            noColumns: cols,
                            backgroundOpacity: 0
                         },
                         hoverable: true,
                         images: [
                            {
                              x: 0.5,
                              y: 0.9,
                              sizex: 0.8,
                              sizey: 0.8,
                                // desired custom background file must be placed into source directory
                              source: "../static/img/graph-background.png", // e.g."../static/img/CUSTOM-background.png"
                              xanchor: "center",
                              xref: "x",
                              opacity: 0.5,
                              yanchor: "center",
                              yref: "y",
                              layer: "below"
                            }
                         ]
                        });
            };

        self.updatePlot = function() {
        	var data = [];
        	self.fanSpeed.sort();
            var actualFanSpeed = self.fanSpeed && self.fanSpeed.length ? formatFanSpeed(self.fanSpeed[self.fanSpeed.length - 1][1],1) : "-";
            var graphColors = ["red", "orange", "lightgreen", "brown","pink", "purple"];
            for(var i=0;i<self.tempControllers().length;i++){
                self.actTemp[i].sort();
                var actualTemp = self.actTemp[i] && self.actTemp[i].length ? formatTemperature(self.actTemp[i][self.actTemp[i].length - 1][1]) : "-";
                self.targetTemp[i].sort();
                self.currentTargetTemp = self.targetTemp[i] && self.targetTemp[i].length ? formatTemperature(self.targetTemp[i][self.targetTemp[i].length - 1][1]) : "-";

                data.push({
                    label: self.tempControllers()[i] + gettext(" Actual") +  ": " + actualTemp,
                    color: graphColors[i],
                    data: self.actTemp[i]
                });
                data.push({
                    label: self.tempControllers()[i] + gettext(" Target") + ": " + self.currentTargetTemp,
                    color: pusher.color(graphColors[i]).tint(0.5).html(),
                    data: self.targetTemp[i]
                });
            }

        	data.push({
                label: gettext("Fan") + ": " + actualFanSpeed,
                color: "green",
                data: self.fanSpeed
            });

    		$.plot("#pidtune-graph", data, self.pidPlotOptions(), {scrollZoom: true,displayModeBar: true});

    		
           
        };
        
        self.sendCommand = function(command) {
            if (command) {
                $.ajax({
                    url: API_BASEURL + "printer/command",
                    type: "POST",
                    dataType: "json",
                    contentType: "application/json; charset=UTF-8",
                    data: JSON.stringify({"command": command})
                });
            }
        };

        self.backupBtn = function() {
            self.setControls(false);
            var currentBackupDate = new Date();
            var backupYear = currentBackupDate.getFullYear();
            var backupMonth = currentBackupDate.getMonth() + 1;
            if (backupMonth < 10)
            backupMonth = '0' + backupMonth;
            var backupDay = currentBackupDate.getDate();
            if (backupDay < 10)
            backupDay = '0' + backupDay;
            var backupHours = currentBackupDate.getHours();
            if (backupHours < 10)
            backupHours = '0' + backupHours;
            var backupMinutes = currentBackupDate.getMinutes();
            if (backupMinutes < 10)
            backupMinutes = '0' + backupMinutes;
            var backupSeconds = currentBackupDate.getSeconds();
            if (backupSeconds < 10)
            backupSeconds = '0' + backupSeconds;
            var backupDate = backupYear + '-' + backupMonth + '-' + backupDay + '_' + backupHours + backupMinutes + backupSeconds;
            var backupValues = self.pidData.ki() + ";" + self.pidData.kd() + ";" + self.pidData.kp()+ ";";
            console.log(backupValues);
            var element = document.createElement('a');
            element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(backupValues));
            element.setAttribute('download', 'pid_marlin_' + self.selectedController() + '_' + backupDate + '.cfg');
            element.style.display = 'none';
            document.body.appendChild(element);
            element.click();

            document.body.removeChild(element);
            setTimeout(function() {self.setControls(true); }, 2000);
        };

        self.updateKp = function(kp) {
            self.pidData.kp(kp);
        }.bind(self);

        self.updateKi = function(ki) {
            self.pidData.ki(ki);
        }.bind(self);

        self.updateKd = function(kd) {
            self.pidData.kd(kd);
        }.bind(self);

        self.handleFileSelect = function(evt) {
            var files = evt.target.files;
            evt.stopPropagation()
            for (var i = 0, f; f = files[i]; i++) {
                var reader = new FileReader();
                reader.onload =function (e) {
                    e.stopPropagation()
                    self.setControls(false);
                    var backupValues = e.target.result;
                    var pidArgs = backupValues.split(';');
                    self.updateKp(pidArgs[2]);
                    self.updateKi(pidArgs[0]);
                    self.updateKd(pidArgs[1]);
                }.bind(self);

                reader.readAsText(f);
            }
            $('#btnApply').addClass("btn-primary");
            setTimeout(function() {self.setControls(true); }, 2000);
        };

        self.restoreBtn = function() {
            if (window.File && window.FileReader && window.FileList && window.Blob) {
                // Great success! All the File APIs are supported.
            } else {
                alert('The File APIs are not fully supported in this browser.');
            }
            var element = document.getElementById('pidFileBackup');
            element.addEventListener('change', self.handleFileSelect, false);
            element.click();
        };

        self.onAfterTabChange = function(current, previous) {
        	if (current != "#tab_plugin_pidtune") {
                return;
            }
            self.updatePlot();
        };
    }
    function formatFanSpeedVal(speed, showP){
        if (speed === undefined || !_.isNumber(speed)) return "-";
        if (showP) {
            return parseInt((100.0/255.0)*speed);
        }
        else {
            return speed;
        }
    }
    function formatFanSpeed(speed, showP) {
        if (speed === undefined || !_.isNumber(speed)) return "-";
        if (speed <= 0) return gettext("off");
        if (showP) {
            return _.sprintf("%i%%", speed);
        } else {
            return _.sprintf("%i pwm", speed);
        }
    }
    function updateMaxTemp(newValue, oldValue){
            return Math.max(110,Math.max(newValue, oldValue));
        }
    // view model class, parameters for constructor, container to bind to
    OCTOPRINT_VIEWMODELS.push([
        PidtuneViewModel,

        // e.g. loginStateViewModel, settingsViewModel, ...
        ["loginStateViewModel", "settingsViewModel"],

        // e.g. #settings_plugin_pidtune, #tab_plugin_pidtune, ...
        "#tab_plugin_pidtune"
    ]);
});
