"""EnergyPlus translation extension for OSM weather-period objects omitted by SDK 3.11."""
# Entity: Building Simulation
# Relationship: Adds the exact frozen OSM sizing-period fields to the translated IDF before EnergyPlus; it does not choose or synthesize weather.
import json
import openstudio as os


class ApplyWeatherSizing(os.measure.EnergyPlusMeasure):
    def name(self): return 'Apply saved weather sizing periods'
    def description(self): return 'Translate the saved OSM weather-condition sizing periods before simulation.'
    def modeler_description(self): return 'Explicit SDK 3.11 translation gap: preserves the five EnergyPlus fields and refuses conflicting duplicate names.'

    def arguments(self, workspace):
        arguments=os.measure.OSArgumentVector()
        periods=os.measure.OSArgument.makeStringArgument('periods',True)
        periods.setDisplayName('Saved weather sizing fields')
        arguments.append(periods)
        return arguments

    def run(self, workspace, runner, user_arguments):
        super().run(workspace,runner,user_arguments)
        if not runner.validateUserArguments(self.arguments(workspace),user_arguments): return False
        try:
            rows=json.loads(runner.getStringArgumentValue('periods',user_arguments))
            if not isinstance(rows,list) or not 1 <= len(rows) <= 32:
                raise ValueError('One to thirty-two exact saved weather periods are required')
            kind=os.IddObjectType('SizingPeriod_WeatherFileConditionType')
            existing_objects=list(workspace.getObjectsByType(kind))
            existing={item.nameString():item for item in existing_objects}
            if len(existing)!=len(existing_objects): raise ValueError('Duplicate translated weather period name')
            seen=set(); added=0
            for fields in rows:
                if not isinstance(fields,list) or len(fields)!=5 or not all(isinstance(value,str) and value for value in fields):
                    raise ValueError('A saved weather period must have five nonempty native fields')
                if fields[0] in seen: raise ValueError('Duplicate saved weather period name')
                seen.add(fields[0])
                if fields[0] in existing:
                    if [existing[fields[0]].getString(i,True).get() for i in range(5)] != fields:
                        raise ValueError('Conflicting translated weather period')
                    continue
                obj=os.IdfObject(kind)
                for index,value in enumerate(fields):
                    if not obj.setString(index,value): raise ValueError('Invalid native weather sizing field')
                if not workspace.addObject(obj).is_initialized(): raise ValueError('Could not add native weather sizing period')
                added+=1
            runner.registerFinalCondition(f'{added} saved weather sizing periods translated; {len(seen)} verified.')
            return True
        except (ValueError,TypeError,RuntimeError) as error:
            runner.registerError(str(error)); return False


ApplyWeatherSizing().registerWithApplication()
