#!/usr/bin/env python
# -*- coding: utf-8 -*-
import json
import time

from octoprint.printer import PrinterCallback
from octoprint.util.json import JsonEncoding


def unfreeze(frozen) -> dict:
    return json.loads(
        json.dumps(frozen, default=JsonEncoding.encode, allow_nan=False).replace(
            "</", "<\\/"
        )
    )
class PrinterDataCallBack(PrinterCallback):
    def __init__(self, logger, callback):
        self.full_data = {
            "current": {
                "data": {}
            },
            "temps"  : []
        }
        self._logger = logger
        self._logger.debug("PrinterDataCallBack init")
        self.callback = callback

    def log_data(self, data):
        self._logger.debug(json.dumps(unfreeze(data)), indent=4, sort_keys=True)

    def on_printer_send_current_data(self, data):
        self.full_data["current"]["data"] = unfreeze(data)
        self.update_data()

    def update_data(self):
        self.full_data["current"]["data"]["temps"] = self.full_data["temps"]
        self.full_data["current"]["data"]["serverTime"] = time.time()
        self.callback(self.full_data["current"])
        self.full_data["temps"] = []

    def on_printer_send_initial_data(self, data):
        self._logger.debug("on_printer_send_initial_data")
        # self.log_data(FrozenToDict(data).unfreeze())

    def on_printer_received_registered_message(self, name, output):
        self._logger.debug("on_printer_received_registered_message")
        self._logger.debug("name: %s", name)
        self._logger.debug("output: %s", output)

    def on_printer_add_temperature(self, data):
        self.full_data["temps"].append(unfreeze(data))
        self.update_data()

    def on_printer_add_log(self, data):
        """For messages sent to client terminal (text, sent values gvode)
        _ str
        :type data: dict
        """
        """return
        self._logger.debug("on_printer_add_log")
        self.log_data(data)"""

    def on_printer_add_message(self, data):
        """For messages sent by the printer
        _ str
        """
        """self._logger.debug("on_printer_add_message")
        self.log_data(data)"""
