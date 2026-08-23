import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { ScheduleFields } from './ScheduleFields';

const meta: Meta<typeof ScheduleFields> = {
  title: 'Schedule/ScheduleFields',
  component: ScheduleFields,
};

export default meta;
type Story = StoryObj<typeof ScheduleFields>;

export const TimeBoundedDefault: Story = {
  name: 'Default (時刻を指定)',
  args: { values: {}, fieldErrors: {} },
};

export const AllDayInitial: Story = {
  name: 'Initial value: 終日',
  args: { values: { temporalMode: 'all-day' }, fieldErrors: {} },
};
