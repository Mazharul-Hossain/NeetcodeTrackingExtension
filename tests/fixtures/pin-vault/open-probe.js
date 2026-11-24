/*
 * NeetcodeTrackingExtension/ -> tests/fixtures/pin-vault/ -> open-probe.js
 * Purpose: open the PIN test in a normal tab when its toolbar icon is clicked.
 * Agent skills: Chrome action and options APIs; no credentials handled here.
 */
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
