/** Project overlays share one slot; changing projects never carries an open window across. */
export const projectDialog = $state<{ view: 'none' | 'decisions' | 'recent' | 'journal' }>({
  view: 'none',
});
