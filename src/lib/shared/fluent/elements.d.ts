import type { HTMLAttributes } from 'svelte/elements';
import type { Button, Switch, Checkbox, Radio, Spinner, TextInput } from '@fluentui/web-components';

declare module 'svelte/elements' {
  interface SvelteHTMLElements {
    'fluent-button': HTMLAttributes<Button> & {
      appearance?: 'primary' | 'outline' | 'subtle' | 'transparent';
      shape?: 'circular' | 'rounded' | 'square';
      size?: 'small' | 'medium' | 'large';
      disabled?: boolean;
      'icon-only'?: boolean;
      type?: 'button' | 'submit' | 'reset';
      form?: string;
      name?: string;
      value?: string;
    };
    'fluent-switch': HTMLAttributes<Switch> & { checked?: boolean; disabled?: boolean };
    'fluent-checkbox': HTMLAttributes<Checkbox> & { checked?: boolean; disabled?: boolean; size?: string };
    'fluent-radio': HTMLAttributes<Radio> & { checked?: boolean; disabled?: boolean };
    'fluent-spinner': HTMLAttributes<Spinner> & { appearance?: 'primary' | 'inverted'; size?: string };
    'fluent-text-input': HTMLAttributes<TextInput> & {
      appearance?: 'outline' | 'underline' | 'filled-darker' | 'filled-lighter';
      'control-size'?: 'small' | 'medium' | 'large';
      disabled?: boolean;
      readonly?: boolean;
      required?: boolean;
      type?: string;
      autocomplete?: string;
      placeholder?: string;
      name?: string;
      value?: string;
      spellcheck?: boolean | 'true' | 'false';
    };
  }
}
