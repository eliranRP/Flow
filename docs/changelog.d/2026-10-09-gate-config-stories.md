The pre-push gate no longer opens every story when a change only touches package scripts, tsconfig include lists or the lockfile entries of tools the app does not use. It still opens every story when the app's dependencies, its Storybook scripts, the compiler options the app builds with, or the app's lockfile entries change.

A branch that changes only design images (the rendered screens and logo files) now takes the gate's docs path, lint and the file-size check, since the app reads nothing from design/ but its CSS tokens.
