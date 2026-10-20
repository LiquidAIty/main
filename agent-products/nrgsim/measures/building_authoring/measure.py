"""OpenStudio ModelMeasure entry point for the checked-in building editor."""
# Entity: Building Authoring
# Relationship: The standard OpenStudio measure runner applies one explicit edit to its staged candidate model.
import json
from pathlib import Path
import sys

import openstudio


class BuildingAuthoring(openstudio.measure.ModelMeasure):
    def name(self):
        return "Building Authoring"

    def description(self):
        return "Apply a typed geometry or engineering input to the current building."

    def modeler_description(self):
        return "Lengths are metres. Object identities are OpenStudio handles. No template building is loaded."

    def arguments(self, model):
        arguments = openstudio.measure.OSArgumentVector()
        operation = openstudio.measure.OSArgument.makeStringArgument("operation_json", True)
        operation.setDisplayName("Building operation")
        operation.setDescription("JSON operation using current model handles and SI engineering units.")
        arguments.append(operation)
        return arguments

    def run(self, model, runner, user_arguments):
        super().run(model, runner, user_arguments)
        if not runner.validateUserArguments(self.arguments(model), user_arguments):
            return False
        try:
            sys.path.insert(0, str(Path(__file__).parent / "resources"))
            from nrgsim.authoring import apply_authoring
            request = json.loads(runner.getStringArgumentValue("operation_json", user_arguments))
            outcome = apply_authoring(model, request)
            runner.registerFinalCondition(json.dumps(outcome, separators=(",", ":")))
            return True
        except Exception as error:
            runner.registerError(str(error))
            return False


BuildingAuthoring().registerWithApplication()
