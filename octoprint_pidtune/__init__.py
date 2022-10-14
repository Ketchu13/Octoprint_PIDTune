# coding=utf-8
from __future__ import absolute_import

import octoprint.plugin


class PidtunePlugin(
    octoprint.plugin.SettingsPlugin,
    octoprint.plugin.AssetPlugin,
    octoprint.plugin.TemplatePlugin):

    def get_assets(self):
        return dict(
            js=["js/pidtune.js"],
            css=["css/pidtune.css"],
            less=["less/pidtune.less"]
        )

    def get_version(self):
        return self._plugin_version

    def get_update_information(self):
        return dict(
            pidtune=dict(
                displayName="Pidtune Plugin",
                displayVersion=self._plugin_version,
                # version check: github repository
                type="github_commit",
                user="ketchu13",
                repo="OctoPrint-Pidtune",
                current=self._plugin_version,

                # update method: pip
                pip="https://github.com/ketchu13/OctoPrint-Pidtune/archive/{target_version}.zip"
            )
        )


__plugin_name__ = "PIDtune"
__plugin_pythoncompat__ = ">=2.7,<4"


def __plugin_load__():
    global __plugin_implementation__
    __plugin_implementation__ = PidtunePlugin()

    global __plugin_hooks__
    __plugin_hooks__ = {
        "octoprint.plugin.softwareupdate.check_config": __plugin_implementation__.get_update_information
    }
