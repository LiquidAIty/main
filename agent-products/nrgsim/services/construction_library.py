"""Read the explicitly configured OpenStudio library; import only a chosen assembly."""
# Entity: Building Modeling
# Relationship: Supplies actual category-specific constructions from the installed Application OSM library with source identity, without applying a standards baseline.
import hashlib
import json
import atexit
from functools import lru_cache
from pathlib import Path
import openstudio as os

CONFIG = Path(__file__).resolve().parents[1] / 'workspace.local.json'


@lru_cache(maxsize=2)
def _load(path, modified, set_name):
    source = Path(path)
    # Parse the upstream OSM with its native dictionary, then resolve only this
    # set's dependency closure. Constructing all 931 sets is unnecessary here.
    loaded = os.IdfFile.load(os.path(str(source)), os.IddFileType('OpenStudio'))
    if not loaded.is_initialized():
        raise ValueError('Configured OpenStudio construction library could not be read')
    source_file = loaded.get()
    objects = {str(obj.handle()): obj for obj in source_file.objects()}
    roots = [obj for obj in source_file.getObjectsByName(set_name) if obj.iddObject().name() == 'OS:DefaultConstructionSet']
    if len(roots) != 1:
        raise ValueError('Configured construction set is absent or ambiguous')
    dependencies, pending = {}, [roots[0]]
    metadata = [obj for obj in objects.values() if obj.iddObject().name().startswith('OS:StandardsInformation:')]
    while pending:
        obj = pending.pop(); handle = str(obj.handle())
        if handle in dependencies:
            continue
        dependencies[handle] = obj
        for index in range(obj.numFields()):
            value = obj.getString(index)
            if value.is_initialized() and value.get() in objects and value.get() not in dependencies:
                pending.append(objects[value.get()])
        for info in metadata:
            target = info.getString(1)
            if target.is_initialized() and target.get() == handle:
                pending.append(info)
    subset = os.IdfFile(os.IddFileType('OpenStudio'))
    subset.addObjects(os.IdfObjectVector(list(dependencies.values())))
    model = os.model.Model(subset)
    selected = model.getDefaultConstructionSetByName(set_name)
    if not selected.is_initialized():
        raise ValueError('Configured construction set is absent from the OpenStudio library')
    items = {}
    for boundary, getter in [('Outdoors','defaultExteriorSurfaceConstructions'), ('Ground','defaultGroundContactSurfaceConstructions'),
                             ('Surface','defaultInteriorSurfaceConstructions'), ('Adiabatic','defaultInteriorSurfaceConstructions')]:
        group = getattr(selected.get(), getter)()
        if not group.is_initialized():
            continue
        for kind, field in [('Wall','wallConstruction'),('Floor','floorConstruction'),('RoofCeiling','roofCeilingConstruction')]:
            assembly = getattr(group.get(), field)()
            if assembly.is_initialized() and assembly.get().to_Construction().is_initialized():
                items[(kind,boundary)] = assembly.get().to_Construction().get()
    return model, items, hashlib.sha256(source.read_bytes()).hexdigest()


atexit.register(_load.cache_clear)


def catalog():
    configuration = json.loads(CONFIG.read_text(encoding='utf-8')) if CONFIG.is_file() else {}
    source, name = configuration.get('constructionLibrary'), configuration.get('constructionSet')
    if not source or not name:
        return {}, None
    path = Path(source)
    if not path.is_file():
        raise ValueError('Configured OpenStudio construction library is missing')
    model, items, sha = _load(str(path), path.stat().st_mtime_ns, name)
    return items, dict(set=name, file=path.name, sha256=sha)


def option(kind, boundary):
    items, source = catalog()
    assembly = items.get((kind,boundary))
    if assembly is None:
        return None
    return {'value': f'library:{kind}:{boundary}', 'label': assembly.nameString() + ' · ' + source['set']}


def import_assembly(model, kind, boundary):
    items, source = catalog()
    assembly = items.get((kind,boundary))
    if assembly is None:
        raise ValueError('No supported assembly exists for this category in the selected library')
    identity = json.dumps(dict(**source, construction=assembly.nameString(), category=kind+':'+boundary), sort_keys=True)
    for existing in model.getConstructions():
        provenance = existing.additionalProperties().getFeatureAsString('construction_library')
        if provenance.is_initialized() and provenance.get() == identity and existing.equalLayers(assembly):
            return existing
    local = assembly.clone(model).to_Construction().get()
    local.additionalProperties().setFeature('construction_library', identity)
    return local
