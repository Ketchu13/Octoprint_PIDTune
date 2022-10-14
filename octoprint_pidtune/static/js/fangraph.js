$(function() {

    function PidtuneViewModel(parameters) {
        var self = this;
        self.max_plot = 100;
        self.actToolsTemp = [][];
        self.targetToolsTemp = [][];
        self.actFansSpeed = [][];
        self.actFansSpeed = [][];
        self.tempControllers = ko.observableArray(["Tool0", "Tool1", "Bed"])
        self.hasBed = ko.observable(true);
        self.bedTemp = self._createToolEntry();
        self.bedTemp["name"](gettext("Bed"));
        self.bedTemp["key"]("bed");

        self.has_fan_parts = ko.observable(true);
        self.fan_parts_speed = self._createToolEntry();
        self.fan_parts_speed["name"](gettext("Fan"));
        self.fan_parts_speed["key"]("fan_parts");

        self.defaultColors = {
            background: '#ffffff',
            axises: '#000000'
        }

        self.defaultImageData = {
              x: 0.5,
              y: 0.9,
              sizex: 0.8,
              sizey: 0.8,
                // desired custom background file must be placed into source directory
              source: "../static/img/graph-background.png", // e.g."../static/img/CUSTOM-background.png"
              xanchor: "center",
              xref: "paper",
              yanchor: "center",
              yref: "paper"
        };

        self._createToolEntry = function() {
            return {
                name: ko.observable(),
                key: ko.observable(),
                actual: ko.observable(0),
                target: ko.observable(0),
                offset: ko.observable(0),
                newTarget: ko.observable(),
                newOffset: ko.observable()
            }
        };

        self.fromCurrentData = function(data) {
        	try {self._processStateData(data.state);}
        	catch (exc) {console.log("_processStateData");console.log(exc);}
        	try {self._processTempData(data.serverTime, data.temps);}
        	catch (exc) {console.log("_processTempData");console.log(exc);}
            try { self._processLogsData(data.logs);}
            catch (exc) {console.log("_processLogsData");console.log(exc);}
            try {self.updatePlot();}
            catch (exc) {console.log("updatePlot");console.log(exc);}
        }.bind(self);