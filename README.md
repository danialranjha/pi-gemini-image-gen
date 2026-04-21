# pi-gemini-image-gen

A pi package that adds Gemini-powered image generation tools to pi and `pi_local` runtimes.

It is designed for workflows like Paperclip where you want to keep the agent on `pi_local` but call Gemini for image generation through a custom tool.

## Features

- `ping_image_extension` sanity-check tool
- `generate_gemini_image` image generation tool
- Optional local saving to project, global, or custom directory
- Returns both text metadata and image attachments
- Reads credentials from `GEMINI_API_KEY` or `GOOGLE_API_KEY`

## Install

### From GitHub

```bash
pi install git:github.com/danialranjha/pi-gemini-image-gen
```

Or:

```bash
pi install https://github.com/danialranjha/pi-gemini-image-gen
```

### For one-off testing

```bash
pi -e git:github.com/danialranjha/pi-gemini-image-gen
```

## Configuration

Set one of:

```bash
export GEMINI_API_KEY="your_key_here"
# or
export GOOGLE_API_KEY="your_key_here"
```

Optional:

```bash
export GEMINI_IMAGE_MODEL="gemini-2.5-flash-image"
export PI_GEMINI_IMAGE_SAVE_MODE="project"
export PI_GEMINI_IMAGE_SAVE_DIR="/absolute/path"
```

## Tools

### `ping_image_extension`

Verifies the extension loaded.

Example prompt:

```text
Call ping_image_extension with message test
```

### `generate_gemini_image`

Parameters:
- `prompt` - required
- `model` - optional
- `aspectRatio` - optional (`1:1`, `3:2`, `4:3`, `16:9`, `9:16`)
- `save` - optional (`none`, `project`, `global`, `custom`)
- `saveDir` - optional, used when `save=custom`

Example prompt:

```text
Use generate_gemini_image with prompt "clean editorial SaaS hero illustration about AI workflow orchestration", aspectRatio "16:9", save "project"
```

## Save behavior

Default save mode is `project`, which writes to:

```text
<repo>/.pi/generated-images/
```

You can override save behavior with env vars or config.

### Config files

Global:

```text
~/.pi/agent/extensions/gemini-image-gen.json
```

Project-local:

```text
.pi/extensions/gemini-image-gen.json
```

Example config:

```json
{
  "model": "gemini-2.5-flash-image",
  "save": "project"
}
```

## Paperclip / `pi_local` use case

This package is suitable for keeping a Paperclip agent on `pi_local` while delegating image generation to Gemini through a custom tool.

Typical flow:
1. agent receives image task
2. agent calls `generate_gemini_image`
3. tool returns image + metadata
4. agent uploads image to your delivery system
5. agent comments back with prompt/model/url/alt text

## Development

Clone and test locally:

```bash
git clone https://github.com/danialranjha/pi-gemini-image-gen.git
cd pi-gemini-image-gen
pi -e .
```

## License

MIT
