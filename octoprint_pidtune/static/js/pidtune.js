/*
 * View model for OctoPrint-Pidtune
 *
 * Author: Ketchu13
 * License: AGPLv3
 */

$(function () {

    function PidtuneViewModel(parameters) {
        var self = this;

        self.updatePlot_tab_selected = false;
        self.loginState = parameters[0];
        self.settingsViewModel = parameters[1];
        console.log("PidtuneViewModel", parameters);
        self.temperature_cutoff = self.settingsViewModel.temperature_cutoff;
        self.temps = {};
        self.temps.max = ko.observable("0");
        self.temps.min = ko.observable("0");
        self.maxtemp = 0;
        self._resetMinMax = false;

        self.getminmaxtemp = false;
        self.actTemp = [];
        self.targetTemp = [];
        self.display_MinMax = ko.observable(undefined);
        self.display_MinMax.subscribe(function (e) {
            self.getminmaxtemp = e;
        });

        self.isErrorOrClosed = ko.observable(undefined);
        self.isOperational = ko.observable(undefined);
        self.isPrinting = ko.observable(undefined);
        self.isPaused = ko.observable(undefined);
        self.isError = ko.observable(undefined);
        self.isReady = ko.observable(undefined);
        self.isLoading = ko.observable(undefined);
        
        self.tempControllers = ko.observableArray(["Tool0", "Tool1", "Bed"])
        self._selectedController = ko.observable("Tool0")

        self._Data = {};

        self.pidData = {};
        self.pidData.bias = ko.observable("-");
        self.pidData.kd = ko.observable("0");
        self.pidData.ki = ko.observable("0");
        self.pidData.kp = ko.observable("0");
        self.pidData.ku = ko.observable("40");
        self.pidData.max = ko.observable("-");
        self.pidData.min = ko.observable("-");
        self.pidData.model = ko.observable("cl")
        self.pidData.td = ko.observable("0");
        self.pidData.ti = ko.observable("0");
        self.pidData.tu = ko.observable("20");

        self.currFanSpeed = 0;
        self.fanSpeed = [];

        self.cycles = ko.observable("8");
        self.pidAutoState = ko.observable("Ready");
        self.stepSize = ko.observable("10");
        self.target = ko.observable("200");

        //====================================================================================================
        self._api_post_command = function (command_, data_, callback_) {
            $.ajax({
                url: API_BASEURL + "plugin/pidtune",
                type: "POST",
                dataType: "json",
                data: JSON.stringify({
                    command: command_,
                    data: data_
                }),
                contentType: "application/json; charset=UTF-8"
            }).done(function (response) {
                if(callback_ != null) {
                    let success = response.success;
                    if (success) {
                        callback_(JSON.parse(response.data));
                    }
                }
            });
        };
        //====================================================================================================

        self.__printerProfileUpdated = function (data) {
            var tempArray = [];
            for(var key in data) {
                var value = data[key];
                tempArray.push(value)
            }
            self.tempControllers(tempArray);
            self._selectedController(tempArray[0]);
        }
        self._printerProfileUpdated = function () {
            self._api_post_command(
                "printer_profile_updated",
                {"data": "data"},
                self.__printerProfileUpdated
            );
        };
        self.settingsViewModel.printerProfiles.currentProfileData.subscribe(function () {
            self._printerProfileUpdated();
            self.settingsViewModel.printerProfiles.currentProfileData().extruder.count.subscribe(self._printerProfileUpdated);
            self.settingsViewModel.printerProfiles.currentProfileData().heatedBed.subscribe(self._printerProfileUpdated);
        });
        self._printerProfileUpdated();
        //====================================================================================================

        self.updatePidDataK = function (newValue) {
            self.pidData.kp(self.pidData.kpCo());
            self.pidData.ki(self.pidData.kiCo());
            self.pidData.kd(self.pidData.kdCo());
        };
        self.updatePidDataT = function (newValue) {
            self.pidData.ti(self.pidData.tiCo());
            self.pidData.td(self.pidData.tdCo());            
            $('#btnApply').addClass("btn-primary");
        };

        self.pidData.kpCo = ko.computed(function () {
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
        self.pidData.kiCo = ko.computed(function () {
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
        self.pidData.kdCo = ko.computed(function () {
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
        self.pidData.tiCo = ko.computed(function () {
            return parseFloat(self.pidData.kp()) / parseFloat(self.pidData.ki())
            //
        });
        self.pidData.tdCo = ko.computed(function () {
            return parseFloat(self.pidData.kd()) / parseFloat(self.pidData.kp())
            //
        });

        self._selectedController.subscribe(function (newValue) {
            console.log("Selected Controller: " + newValue);
            if (self._selectedController().slice(0, 4) == 'Tool') {
                self.target(self.settingsViewModel.settings.plugins.pidtune.h_tm());
            }
            else if (self._selectedController() == 'Bed') {
                self.target(self.settingsViewModel.settings.plugins.pidtune.b_tm());
            }

        });
        self.pidData.tu.subscribe(self.updatePidDataK);
        self.pidData.ku.subscribe(self.updatePidDataK);

        self.pidData.model.subscribe(self.updatePidDataK);

        self.pidData.kp.subscribe(self.updatePidDataT);
        self.pidData.ki.subscribe(self.updatePidDataT);
        self.pidData.kd.subscribe(self.updatePidDataT);

        self.pidData.ti.subscribe(function (newValue) { self.pidData.ki(self.pidData.kp() / newValue) });
        self.pidData.td.subscribe(function (newValue) { self.pidData.kd(self.pidData.kp() * newValue) });

        self.updateKp = function (kp) { self.pidData.kp(kp); }.bind(self);
        self.updateKi = function (ki) { self.pidData.ki(ki); }.bind(self);
        self.updateKd = function (kd) { self.pidData.kd(kd); }.bind(self);
        //====================================================================================================

        self.start_pid_autotune = function (data) {
            $('#btnSave').removeClass("btn-primary");
            $('#btnApply').removeClass("btn-primary");
            self.pidAutoState("Running");
        };

        self.resetMinMax = function(){
            self._resetMinMax = true;
        };

        self.updateMax = function(maxt) {
            self.temps.max(maxt);
        }.bind(self);

        self.updateMin = function(mint) {
            self.temps.min(mint);
        }.bind(self);

        self.setControls = function (state) {
            if (self.stateControls != state) {
                self.stateControls = state;
                $('#btnApply').prop('disabled', !state);
                $('#btnSave').prop('disabled', !state);
                $('#btnRestore').prop('disabled', !state);
                $('#btnBackup').prop('disabled', !state);
                $('#btnCurrent').prop('disabled', !state);
            }
        };

        //======================Buttons=========================
        self.autoBtn = function () {
            if (self._selectedController().slice(0, 4) == 'Tool') {
                data = { command: "M303 E" + self._selectedController().slice(4, 5) + " S" + self.target() + " C" + self.cycles() };
            }
            else if (self._selectedController() == 'Bed') {
                data = { command: "M303 E-1 S" + self.target() + " C" + self.cycles() };
            }
            self._api_post_command(
                "pid_autotune",
                data,
                self.start_pid_autotune
            );
        };

        self.manualBtn = function () {
            if (self._selectedController().slice(0, 4) == 'Tool') {
                self.sendCommand("M104 T" + self._selectedController().slice(4, 5) + " S" + self.target());
            }
            else if (self._selectedController() == 'Bed') {
                self.sendCommand("M140 S" + self.target());
            }
        };
        self.incBtn = function () {
            var newTarget = parseFloat(self.currentTargetTemp) + parseFloat(self.stepSize());
            if (self._selectedController().slice(0, 4) == 'Tool') {
                self.sendCommand("M104 T" + self._selectedController().slice(4, 5) + " S" + newTarget);
            }
            else if (self._selectedController() == 'Bed') {
                self.sendCommand("M140 S" + newTarget);
            }
        };
        self.decBtn = function () {
            var newTarget = parseFloat(self.currentTargetTemp) - parseFloat(self.stepSize());
            if (self._selectedController().slice(0, 4) == 'Tool') {
                self.sendCommand("M104 T" + self._selectedController().slice(4, 5) + " S" + newTarget);
            }
            else if (self._selectedController() == 'Bed') {
                self.sendCommand("M140 S" + newTarget);
            }
        };
        self.offBtn = function () {
            if (self._selectedController().slice(0, 4) == 'Tool') {
                self.sendCommand("M104 T" + self._selectedController().slice(4, 5) + " S0");
            }
            else if (self._selectedController() == 'Bed') {
                self.sendCommand("M140 S0");
            }
        };
        
        self.applyBtn = function () {
            if (self._selectedController().slice(0, 4) == 'Tool') {
                self.sendCommand("M301 E" + self._selectedController().slice(4, 5) + " P" + $('#Kp').val() + " I" + $('#Ki').val() + " D" + $('#Kd').val());
            }
            else if (self._selectedController() == 'Bed') {
                self.sendCommand("M304 P" + self.pidData.kp() + " I" + self.pidData.ki() + " D" + self.pidData.kd());
            }
            $('#btnApply').removeClass("btn-primary");
            $('#btnSave').addClass("btn-primary");
        };
        self.saveBtn = function () {
            self.sendCommand("M500");
            $('#btnSave').removeClass("btn-primary");
        };
        self.currentBtn = function () {
            $('#btnSave').removeClass("btn-primary");
            $('#btnApply').removeClass("btn-primary");
            if (self._selectedController().slice(0, 4) == 'Tool') {
                self.sendCommand("M301 E" + self._selectedController().slice(4, 5));
            }
            else if (self._selectedController() == 'Bed') {
                self.sendCommand("M304");
            }
        };
        self.backupBtn = function () {
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
            var backupValues = self.pidData.ki() + ";" + self.pidData.kd() + ";" + self.pidData.kp() + ";";
            console.log(backupValues);
            var element = document.createElement('a');
            element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(backupValues));
            element.setAttribute('download', 'pid_marlin_' + self._selectedController() + '_' + backupDate + '.cfg');
            element.style.display = 'none';
            document.body.appendChild(element);
            element.click();

            document.body.removeChild(element);
            setTimeout(
                function () {
                    self.setControls(true);
                },
                2000
            );
        };
        self.restoreBtn = function () {
            if (window.File && window.FileReader && window.FileList && window.Blob) {
                // Great success! All the File APIs are supported.
            }
            else {
                alert('The File APIs are not fully supported in this browser.');
            }
            var element = document.getElementById('pidFileBackup');
            element.addEventListener('change', self.handleFileSelect, false);
            element.click();
        };
        //==================================================
        // report js errors to the backend to be logged
        window.onerror = self.log_error;
        window.error = self.log_error;
        self.log_error = function (msg, url, lineNo, columnNo, error) {
            var message;
            if (msg.toLowerCase().indexOf("script error") > -1) {
                message = 'Script Error: See Browser Console for Detail';
            } else {
                var message = [
                    'Message: ' + msg,
                    'URL: ' + url,
                    'Line: ' + lineNo,
                    'Column: ' + columnNo,
                    'Error object: ' + JSON.stringify(error)
                ].join(' - ');
            }

            self._api_post_command(
                "js_error",
                message,
                null
            );

            return false;
        };
        //===================Temps data=====================
        self.fromCurrentData = function (data) { // data is a dict
            try {
                self._processStateData(data.state);
            }
            catch (exc) { console.log(exc); }
            try {
                self._processTempData(data);
            }
            catch (exc) { console.log(exc); }
            try {
                self.updatePlot();
            }
            catch (exc) { console.log(exc); }
        };

        self._processTempData = function (data) {
            var datatemps = data.temps;
            for (var i = 0; i < datatemps.length; i++) {
                for(var j = 0; j < self.tempControllers().length; j++){
                    var objActual = parseFloat(datatemps[i][self._selectedController().toLowerCase()].actual);
                    if (self.getminmaxtemp == true) {
                        if (j == 0) {
                            if (self._resetMinMax == true ) {
                                self.updateMax(objActual);
                                self.updateMin(objActual);
                                self._resetMinMax = false;
                            } else {
                                self.updateMax( updateMaxTemp(objActual,self.temps.max()));
                                self.updateMin( updateMinTemp(objActual,self.temps.min()));
                            }
                        }
                    }
                }
            }
        }.bind(self);

        self._processStateData = function (data) {
            self.isErrorOrClosed(data["flags"]["closedOrError"] );
            self.isOperational(  data["flags"]["operational"]   );
            self.isPaused(       data["flags"]["paused"]        );
            self.isPrinting(     data["flags"]["printing"]      );
            self.isError(        data["flags"]["error"]         );
            self.isReady(        data["flags"]["ready"]         );
            self.isLoading(      data["flags"]["loading"]       );
        }.bind(self);
        //==================================================
        self.showDialog = function (){
            dialogId = "#sidebar_pidtune-test_simpleDialog";
            confirmFunction = function (dialog) {
                dialog.modal('hide');
            };

            var myDialog = $(dialogId);
            var confirmButton = $("button.btn-confirm", myDialog);
            var cancelButton = $("button.btn-cancel", myDialog);
            //var dialogTitle = $("h3.modal-title", editDialog);

            confirmButton.unbind("click");
            confirmButton.bind("click", function() {
                alert ("Do something");
                confirmFunction(myDialog);
            });
            myDialog.modal({
                //minHeight: function() { return Math.max($.fn.modal.defaults.maxHeight() - 80, 250); }
            }).css({
                width: 'auto',
                'margin-left': function() { return -($(this).width() /2); }
            });
        };
        //=====================Graph=======================        
        self.pidPlotOptions = function (max_temp, cols) {
            return ({
                yaxis: {
                    min: 0,
                    max: max_temp,
                    ticks: 10
                },
                xaxis: {
                    mode: "time",
                    type: 'scatter',
                    minTickSize: [30, "second"],
                    tickFormatter: function (val, axis) {
                        if (val == undefined || val == 0)
                            return "";

                        // current time in milliseconds in UTC
                        var timestampUtc = Date.now();

                        // calculate difference in milliseconds
                        var diff = timestampUtc - val;

                        // convert to minutes
                        var diffInMins = Math.round(diff / (60 * 1000));
                        var moduloscd = ((diff / (60 * 1000))% 1) * 100 * (60/100);
                        var tickvalue = "- " + diffInMins + " " + "min";
                        if (moduloscd != 0){
                            tickvalue = "- " + diffInMins + "" + "min" + " " + Math.round(moduloscd) + gettext("s");
                        }
                        if (diffInMins == 0)
                            return gettext("just now");
                        else
                            return tickvalue;
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
                ],
                zoom: {
                    interactive: true
                },
                pan: {
                    interactive: true,
                    enableTouch: true
                }
            });
        };

        self.__updatePlot = function (data) {
            if (self.updatePlot_tab_selected == false) {
                return;
            }
            var datatemps = data["data"];
            var maxplotdata = [];
            for (var i = 0; i < datatemps.length; i++) {
                for(var j = 0; j < datatemps[i]["data"].length; j++){
                    var objActual = parseFloat(datatemps[i]["data"][j][1]);
                    maxplotdata.push(objActual);
                }
            }
            var max_temp = Math.max.apply(Math, maxplotdata);
            $.plot(
                "#pidtune-graph",
                data["data"],
                self.pidPlotOptions(max_temp+10),
                {
                    scrollZoom: true,
                    displayModeBar: true
                }
            );
        }
        self.updatePlot = function () {
            self._api_post_command(
                "update",
                {"data": "data"},
                self.__updatePlot
            );
        };

        self.resetAdvgraph = function () {
            self._printerProfileUpdated();
            try {
                var plt = $.plot("#pidtune-graph", [], self.pidPlotOptions(0, 0));
                plt.destroy();
                console.log("reset");
                self.updatePlot();
            }
            catch (exc) { console.log(exc) }
            console.log("reset");
        };

        self.onAfterTabChange = function(current, previous) {
            if (current != "#tab_plugin_pidtune") {
                self.updatePlot_tab_selected = false;
                return;
            }
            if($('#Kp').val() <= 0.0){
                $('#btnSave').removeClass("btn-primary");
                $('#btnApply').removeClass("btn-primary");
                if (self._selectedController().slice(0, 4) == 'Tool') {
                    self.sendCommand("M301 E" + self._selectedController().slice(4, 5));
                }
                else if (self._selectedController() == 'Bed') {
                    self.sendCommand("M304");
                }
                else if (self._selectedController() == 'Chamber') {
                    self.sendCommand("M305");
                }
                else if (self._selectedController() == 'Cooler') {
                    self.sendCommand("M306");
                }
            }
            self.updatePlot_tab_selected = true;
        };

        //==================================================

        self.showPluginConfig = function () { return true; };
  
        self.handleFileSelect = function (evt) {
            var files = evt.target.files;
            evt.stopPropagation()
            for (var i = 0, f; f = files[i]; i++) {
                var reader = new FileReader();
                reader.onload = function (e) {
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
            setTimeout(function () { self.setControls(true); }, 2000);
        };

        //====================================================================================================
        self.sendCommand = function (command) {
            if (command) {
                $.ajax({
                    url: API_BASEURL + "printer/command",
                    type: "POST",
                    dataType: "json",
                    contentType: "application/json; charset=UTF-8",
                    data: JSON.stringify({ "command": command })
                });
            }
        };
        // DataUpdater
        self.onDataUpdaterPluginMessage = function (plugin, data) {
            if (typeof plugin == 'undefined') {
                return;
            }

            if (plugin !== "pidtune") {
                return;
            }

            if (data.type === "piddata") {
                var tool_index = 0;
                if (self._selectedController() == 'Bed'){
                    tool_index = -1;
                } else {
                    tool_index = parseInt(self._selectedController().slice(4, 5));
                }
                if (data.data[tool_index]["bias"]    != null) { self.pidData.bias(parseFloat(data.data[tool_index]["bias"])); }
                if (data.data[tool_index]["min"]     != null) {  self.pidData.min(parseFloat(data.data[tool_index]["min"] )); }
                if (data.data[tool_index]["max"]     != null) {  self.pidData.max(parseFloat(data.data[tool_index]["max"] )); }
                if (data.data[tool_index]["ku"]      != null) {   self.pidData.ku(parseFloat(data.data[tool_index]["ku"]  )); }
                if (data.data[tool_index]["tu"]      != null) {   self.pidData.tu(parseFloat(data.data[tool_index]["tu"]  )); }
                if (data.data[tool_index]["kp"]      != null) {   self.pidData.kp(parseFloat(data.data[tool_index]["kp"]  )); }
                if (data.data[tool_index]["ki"]      != null) {   self.pidData.ki(parseFloat(data.data[tool_index]["ki"]  )); }
                if (data.data[tool_index]["kd"]      != null) {   self.pidData.kd(parseFloat(data.data[tool_index]["kd"]  )); }
            }
            if (data.type === "update") {
                if (data) { //self.updatePlot2(data);
                    console.log(data);
                }
                else {}
            }

            if (data.type === "locked") {
                //self.loading(false);
                //self.printer_locked(true);
            }

            if (data.type === "unlocked") {
                //self.loading(false);
                //self.printer_locked(false);
            }

            if (data.type === "processed_temp_data") {}
        };
    }

    function formatFanSpeedVal(speed, showP) {
        if (speed === undefined || !_.isNumber(speed)) return "-";
        if (showP) {
            return parseInt((100.0 / 255.0) * speed);
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
    function updateMaxTemp(newValue, oldValue) {
        return Math.max(0, Math.max(newValue, oldValue));
    }
    function updateMinTemp(newValue, oldValue){
        if(oldValue == 0){
            return newValue;
        }else {
            return Math.min(newValue, oldValue);
        }
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
