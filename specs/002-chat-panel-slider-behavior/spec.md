# Specification: Chat Panel Slider Behavior

## Purpose
Improve chat panel dragging behavior in Agent Builder so users can resize farther left, pull to collapse companion mode, and experience smoother motion.

## Desired Behavior
- The chat panel divider can move farther left than current behavior.
- Dragging the divider near the far-right edge collapses the current companion/canvas mode back to chat-only mode.
- Drag motion feels smooth and predictable.
- Existing under-chat reveal / canvas-under-chat interaction remains intact.

## Success Criteria
- Users can resize the chat panel to a visibly smaller minimum width.
- Users can collapse companion/canvas mode by dragging divider to the right edge threshold.
- Drag interaction feels smoother during pointer movement.
- No regression in standard workspace mode switching.

## Out Of Scope
- Full layout architecture redesign.
- New animation libraries.
- Backend/runtime behavior changes.
- Deep gesture framework rewrite.
