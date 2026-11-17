import { Composition } from 'remotion';
import { FPS } from '../timeline.ts';
import { Explainer, type ExplainerProps } from './Explainer.tsx';
import { Thumbnail, type ThumbnailProps } from './Thumbnail.tsx';

/** 台本と音声は、npm run make が inputProps で渡す。ここの値は Remotion Studio で開いたとき用の空の既定値 */
const EMPTY: ExplainerProps = { title: '', lines: [], totalFrames: FPS, tachie: {}, screens: {} };
/** サムネイルの中身は、npm run thumbnail が inputProps で渡す */
const EMPTY_THUMBNAIL: ThumbnailProps = { title: [], subtitle: [], badge: '', expressions: {}, tachie: {} };

export function Root() {
  return (
    <>
      <Composition
        id="Explainer"
        component={Explainer}
        width={1920}
        height={1080}
        fps={FPS}
        durationInFrames={FPS}
        defaultProps={EMPTY}
        calculateMetadata={({ props }) => ({ durationInFrames: props.totalFrames })}
      />
      <Composition id="Thumbnail" component={Thumbnail} width={1280} height={720} fps={FPS} durationInFrames={1} defaultProps={EMPTY_THUMBNAIL} />
    </>
  );
}
