import { Extension, InputRule } from '@tiptap/core'

export const TaskInputRules = Extension.create({
  name: 'taskInputRules',

  addInputRules() {
    return [
      new InputRule({
        find: /^\s*\[([ xX])\]\s$/,
        handler: ({ state, range, match, chain }) => {
          const checked = match[1].toLowerCase() === 'x'
          const $from = state.doc.resolve(range.from)
          const inListItem =
            $from.node(-1)?.type.name === 'listItem' ||
            $from.node(-1)?.type.name === 'taskItem'

          const c = chain().deleteRange(range)

          if (inListItem) {
            c.toggleList('taskList', 'taskItem')
          } else {
            c.toggleTaskList()
          }

          if (checked) {
            c.updateAttributes('taskItem', { checked: true })
          }

          c.run()
        },
      }),
    ]
  },
})
