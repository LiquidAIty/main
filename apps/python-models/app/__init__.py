# Entity: Python Rails
# Relationship: Establishes the Python application as a regular package so its modules win deterministic import resolution over the separate KnowGraph app module.

# Python rails application package.
#
# This file makes ``app`` a REGULAR package (not an implicit namespace package). It is the durable
# fix for the import-shadow collision: ``services/knowgraph/app.py`` is a separate, legitimate
# top-level ``app`` module, and while ``app`` was a namespace package a regular ``app.py`` on any
# sys.path entry would shadow it regardless of order (dragging in unrelated deps). As a regular
# package, ``app`` resolves to this directory whenever ``apps/python-models`` precedes a colliding
# entry on sys.path — no runtime sys.path/sys.modules manipulation required.
