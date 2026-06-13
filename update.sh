#!/bin/bash
# Update bundled sub-skills from upstream sources
set -e

echo "=== wechat-content-studio plugin: updating sub-skills ==="

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS_DIR="$ROOT_DIR/plugins/just-write/skills"

update_git() {
    local dir="$1"
    local repo="$2"
    if [ -d "$dir/.git" ]; then
        echo "  Updating $(basename "$dir")..."
        git -C "$dir" pull origin main
    else
        echo "  Cloning $(basename "$dir") from $repo..."
        rm -rf "$dir"
        git clone --depth 1 "$repo" "$dir"
    fi
}

# baoyu-post-to-wechat (JimLiu/baoyu-skills subdirectory)
# Note: this is a subdirectory, clone the whole repo then copy
echo "[baoyu-post-to-wechat]"
TMPDIR=$(mktemp -d)
git clone --depth 1 https://github.com/JimLiu/baoyu-skills.git "$TMPDIR" 2>/dev/null
cp -r "$TMPDIR/skills/baoyu-post-to-wechat/SKILL.md" "$SKILLS_DIR/baoyu-post-to-wechat/"
cp -r "$TMPDIR/skills/baoyu-post-to-wechat/scripts/" "$SKILLS_DIR/baoyu-post-to-wechat/scripts/"
rm -rf "$TMPDIR"

# humanizer-zh (op7418/Humanizer-zh)
echo "[humanizer-zh]"
TMPDIR=$(mktemp -d)
git clone --depth 1 https://github.com/op7418/Humanizer-zh.git "$TMPDIR" 2>/dev/null
cp "$TMPDIR/SKILL.md" "$SKILLS_DIR/humanizer-zh/"
rm -rf "$TMPDIR"

# baoyu-format-markdown (JimLiu/baoyu-skills subdirectory)
echo "[baoyu-format-markdown]"
TMPDIR=$(mktemp -d)
git clone --depth 1 https://github.com/JimLiu/baoyu-skills.git "$TMPDIR" 2>/dev/null
cp -r "$TMPDIR/skills/baoyu-format-markdown/SKILL.md" "$SKILLS_DIR/baoyu-format-markdown/"
cp -r "$TMPDIR/skills/baoyu-format-markdown/scripts/" "$SKILLS_DIR/baoyu-format-markdown/scripts/"
cp -r "$TMPDIR/skills/baoyu-format-markdown/references/" "$SKILLS_DIR/baoyu-format-markdown/references/"
rm -rf "$TMPDIR"


# brainstorming (obra/superpowers)
echo "[brainstorming]"
TMPDIR=$(mktemp -d)
git clone --depth 1 --filter=blob:none --sparse https://github.com/obra/superpowers.git "$TMPDIR" 2>/dev/null
git -C "$TMPDIR" sparse-checkout set skills/brainstorming
cp "$TMPDIR/skills/brainstorming/SKILL.md" "$SKILLS_DIR/brainstorming/"
rm -rf "$TMPDIR"

echo "=== Update complete ==="
