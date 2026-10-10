# Category lines: the name keeps the row's width

- Kind: component
- Changed: a category's lines that are kept out of profit carry the ⊘ tag after the name. The set-aside rule that protects the "לא נספר ברווח" words (title `contain: inline-size`, text column `min-content`) also applied to these rows, which have no such words, so the name shrank to "S..". Rows marked by the tag now skip that rule and the name uses the free width.
- Rule: a name is cut only when it does not fit (DESIGN-RULES), never to protect words the row does not show.
- Story: ListRow "Set aside tagged".
