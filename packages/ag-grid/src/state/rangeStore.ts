import { createStore } from "./createStore";
import type { Store } from "./createStore";
import type { CellPos, CellRange, NormalizedRange } from "../range/geometry";

export interface RangeStoreState {
  range: CellRange | null;
  dragging: boolean;
  fillPreview: NormalizedRange | null;
}

export interface RangeStore extends Store<RangeStoreState> {
  setAnchor(pos: CellPos): void;
  setFocus(pos: CellPos): void;
  clear(): void;
  get(): CellRange | null;
  setDragging(dragging: boolean): void;
  setFillPreview(preview: NormalizedRange | null): void;
}

export function createRangeStore(): RangeStore {
  const store = createStore<RangeStoreState>({ range: null, dragging: false, fillPreview: null });

  const setAnchor = (pos: CellPos): void => {
    store.setState({ range: { anchor: pos, focus: pos } });
  };

  const setFocus = (pos: CellPos): void => {
    const current = store.getState().range;
    if (!current) {
      setAnchor(pos);
      return;
    }
    store.setState({ range: { anchor: current.anchor, focus: pos } });
  };

  const clear = (): void => {
    store.setState({ range: null });
  };

  const get = (): CellRange | null => store.getState().range;

  const setDragging = (dragging: boolean): void => {
    store.setState({ dragging });
  };

  const setFillPreview = (preview: NormalizedRange | null): void => {
    store.setState({ fillPreview: preview });
  };

  return {
    ...store,
    setAnchor,
    setFocus,
    clear,
    get,
    setDragging,
    setFillPreview,
  };
}
