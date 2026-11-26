// Clicking the toolbar icon opens a new tab, which is Markab itself.
export default defineBackground(() => {
  browser.action.onClicked.addListener(() => {
    void browser.tabs.create({})
  })
})
