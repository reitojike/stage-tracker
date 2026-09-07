import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from '@/ui/Button';
import type { CatalogFilterSelection, Genre, Group } from '@/domain/eventCatalog.ts';
import { FilterSheet, type FilterSheetProps } from './FilterSheet';

// Fixture data shaped exactly like #167's read boundary (Issue #147 must
// not depend on a Production DB for Storybook/tests) - three genres, Gate
// A's fixed 宝塚→歌舞伎→アイドル order, group options for the group-facet
// genres and venue text for the venue-facet genre.
const GENRES: Genre[] = [
  { id: 'genre-takarazuka', key: 'takarazuka', displayName: '宝塚', sortOrder: 1 },
  { id: 'genre-kabuki', key: 'kabuki', displayName: '歌舞伎', sortOrder: 2 },
  { id: 'genre-idol', key: 'idol', displayName: 'アイドル', sortOrder: 3 },
];

const TAKARAZUKA_GROUPS: Group[] = [
  { id: 'group-hana', key: 'hana', displayName: '花組' },
  { id: 'group-tsuki', key: 'tsuki', displayName: '月組' },
  { id: 'group-yuki', key: 'yuki', displayName: '雪組' },
  { id: 'group-hoshi', key: 'hoshi', displayName: '星組' },
  { id: 'group-sora', key: 'sora', displayName: '宙組' },
];

const IDOL_GROUPS: Group[] = [
  { id: 'group-a', key: 'idol-group-a', displayName: 'グループA' },
  { id: 'group-b', key: 'idol-group-b', displayName: 'グループB' },
];

const KABUKI_VENUES: readonly string[] = ['歌舞伎座', '南座', '御園座'];

const FULL_OPTIONS: Pick<FilterSheetProps, 'groupOptionsByGenreKey' | 'venueOptionsByGenreKey'> = {
  groupOptionsByGenreKey: { takarazuka: TAKARAZUKA_GROUPS, idol: IDOL_GROUPS },
  venueOptionsByGenreKey: { kabuki: KABUKI_VENUES },
};

function FilterSheetDemo({
  genresOverride,
  groupOptionsByGenreKey,
  venueOptionsByGenreKey,
}: Pick<FilterSheetProps, 'groupOptionsByGenreKey' | 'venueOptionsByGenreKey'> & {
  /** Gate A's real 3-genre catalog never exercises the chip-wrap or
   * >10-genre dropdown-fallback presentation - these two states are
   * demonstrated with a synthetic genre list a real catalog cannot
   * currently produce (see ManyGenresWrapping/TooManyGenresDropdownFallback
   * below). Defaults to the real 3-genre fixture. */
  genresOverride?: readonly Genre[];
}) {
  const [open, setOpen] = useState(true);
  const [selection, setSelection] = useState<CatalogFilterSelection | null>(null);

  return (
    <div style={{ minHeight: '70vh' }}>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        絞り込みを開く
      </Button>
      <p style={{ marginTop: 12, fontSize: 12 }}>
        applied selection: <code>{JSON.stringify(selection)}</code>
      </p>
      <FilterSheet
        open={open}
        onOpenChange={setOpen}
        genres={genresOverride ?? GENRES}
        groupOptionsByGenreKey={groupOptionsByGenreKey}
        venueOptionsByGenreKey={venueOptionsByGenreKey}
        onAppliedSelectionChange={setSelection}
      />
    </div>
  );
}

const meta: Meta<typeof FilterSheet> = {
  title: 'Catalog/FilterSheet',
  component: FilterSheet,
};

export default meta;
type Story = StoryObj<typeof FilterSheet>;

export const Default: Story = {
  name: 'Open, catalog-wide options loaded',
  render: () => <FilterSheetDemo {...FULL_OPTIONS} />,
};

export const NoOptionsLoadedYet: Story = {
  name: '選択したgenreのsecondary option未取得 (empty universe)',
  render: () => <FilterSheetDemo groupOptionsByGenreKey={{}} venueOptionsByGenreKey={{}} />,
};

// Issue #195: Gate A only ever has 3 genres today, so real data never
// exercises the chip-wrap or >10-genre dropdown-fallback paths - these two
// stories exist purely as visual/regression evidence for those two states,
// with synthetic genre counts a real catalog cannot currently produce.

const SIX_GENRES: Genre[] = [
  ...GENRES,
  { id: 'genre-4', key: 'genre-4', displayName: 'ジャンル4', sortOrder: 4 },
  { id: 'genre-5', key: 'genre-5', displayName: 'ジャンル5', sortOrder: 5 },
  { id: 'genre-6', key: 'genre-6', displayName: 'ジャンル6', sortOrder: 6 },
];

export const ManyGenresWrapping: Story = {
  name: 'genre chipsが2行以上に折り返す (6 genres, no horizontal scroll)',
  render: () => (
    <FilterSheetDemo
      genresOverride={SIX_GENRES}
      groupOptionsByGenreKey={FULL_OPTIONS.groupOptionsByGenreKey}
      venueOptionsByGenreKey={FULL_OPTIONS.venueOptionsByGenreKey}
    />
  ),
};

const ELEVEN_GENRES: Genre[] = Array.from({ length: 11 }, (_, index) => ({
  id: `genre-many-${String(index)}`,
  key: `genre-many-${String(index)}`,
  displayName: `ジャンル${String(index + 1)}`,
  sortOrder: index + 1,
}));

export const TooManyGenresDropdownFallback: Story = {
  name: 'known genreが10を超えるとdropdownへbounded fallback (11 genres)',
  render: () => (
    <FilterSheetDemo
      genresOverride={ELEVEN_GENRES}
      groupOptionsByGenreKey={{}}
      venueOptionsByGenreKey={{}}
    />
  ),
};
