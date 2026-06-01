# LoomN — Phase 1: Foundation + Core Session Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the new native project `C:\Users\nacho\git\LoomN` (its own git repo, CMake + MSVC build, JUCE wired in and proven to compile, Catch2 tests) and implement the JUCE-free `loom_core` data model that parses the existing Loom session JSON (`schemaVersion 3` clip-grid format) into typed C++ structs.

**Architecture:** A new, separate repo. `loom_core` is a static library with **no JUCE dependency** (pure structs + nlohmann/json parsing) so it is unit-testable in isolation — mirroring how the web project's pure logic is tested without a browser. A throwaway `juce_check` console target fetches JUCE and links `juce_core` only, to de-risk the single biggest unknown (does JUCE build under this MSVC/CMake toolchain?) before any real JUCE code is written. The web repo `tb303-synth` is untouched; the two are joined by a VS Code multi-root workspace so Claude Code stays rooted in `tb303-synth` (preserving session transcripts + memory).

**Tech Stack:** C++17 · CMake 3.22+ (Visual Studio 2022 generator — **no ninja on this machine**) · MSVC (VS Build Tools 2022) · [nlohmann/json](https://github.com/nlohmann/json) v3.11.3 (header-only JSON) · [Catch2](https://github.com/catchorg/Catch2) v3.7.1 (unit tests) · [JUCE](https://github.com/juce-framework/JUCE) 8.0.4 (sanity-check only this phase).

**Toolchain verified present (2026-06-01):** git 2.53, cmake 4.3.2, VS Build Tools 2022 (MSVC), `C:\Users\nacho\git\LoomN` does not yet exist, no `loom.code-workspace` yet.

---

## Conventions for every command in this plan

- **Claude Code is rooted in `tb303-synth`, NOT in `LoomN`.** Every command therefore uses absolute paths. Git commands targeting the new repo use `git -C C:/Users/nacho/git/LoomN …`. CMake uses explicit `-S`/`-B` absolute paths.
- **Generator is multi-config** (Visual Studio). Always pass `--config Debug` to `cmake --build` and `-C Debug` to `ctest`. The test exe lands at `C:/Users/nacho/git/LoomN/build/test/Debug/loom_tests.exe`.
- **First configure is slow** (FetchContent shallow-clones nlohmann/json, Catch2, and JUCE). Use a generous timeout (≥600000 ms) on the first `cmake -S … -B …`.
- **Version-bump escape hatch:** if any `GIT_TAG` fails to fetch, open the project's GitHub tags page and pick the nearest tag of the same major line, then update the tag in `CMakeLists.txt`. (JUCE tags: <https://github.com/juce-framework/JUCE/tags>.)

---

## File Structure (created by this plan)

```
C:/Users/nacho/git/
├── loom.code-workspace              # multi-root workspace (Task 9) — lives in the git PARENT dir
├── tb303-synth/                     # the web project — UNTOUCHED by this plan
└── LoomN/                           # NEW repo (git init in Task 1)
    ├── .gitignore                   # ignore build/, .vs/, etc. (Task 1)
    ├── README.md                    # how to configure/build/test (Task 1, expanded Task 9)
    ├── CMakeLists.txt               # top-level build (grows across Tasks 1→3)
    ├── juce/
    │   └── juce_check.cpp           # trivial juce_core-linked main (Task 3)
    ├── src/
    │   └── core/
    │       ├── CMakeLists.txt       # defines the loom_core static lib (Task 4)
    │       ├── SessionModel.h       # pure data structs mirroring SessionState (Task 4)
    │       ├── SessionJson.h        # parseSessionState() declaration (Task 5)
    │       └── SessionJson.cpp      # nlohmann/json parsing (Tasks 5→7)
    └── test/
        ├── CMakeLists.txt           # defines loom_tests + ctest discovery (Task 2)
        ├── fixtures/
        │   ├── minimal-shape.json   # compact hand-written fixture (Task 5)
        │   └── minimal-techno.json  # real demo copied from tb303-synth (Task 8)
        ├── test_smoke.cpp           # trivial Catch2 test proving the harness (Task 2)
        └── test_session_json.cpp    # SessionState parsing tests (Tasks 5→8)
```

**Responsibility boundaries:**
- `SessionModel.h` — *data only*. Plain structs, no logic, no JUCE, no JSON. The single source of truth for the C++ shape of a session.
- `SessionJson.{h,cpp}` — *parsing only*. Turns a JSON string into a `SessionState`. The only file that includes `<nlohmann/json.hpp>`.
- `test/*` — *verification only*.
- `juce/juce_check.cpp` — *throwaway de-risk*, deleted or repurposed in a later phase.

**Out of scope for this phase (parsed in later phases when those subsystems land):** `engineState.modulators`, `engineState.noteFx`, `engineState.sampler.keymap`, per-lane/master `inserts`, and clip `sample` playback semantics. This phase parses `engineState.params` (numbers), `enginePresetName`, clips, notes, envelopes, scenes — everything the sequencing slice needs. `clip.sample` *is* parsed structurally (so data round-trips) but not acted upon.

---

### Task 1: Scaffold the LoomN repo

**Files:**
- Create: `C:/Users/nacho/git/LoomN/.gitignore`
- Create: `C:/Users/nacho/git/LoomN/README.md`
- Create: `C:/Users/nacho/git/LoomN/CMakeLists.txt`

- [ ] **Step 1: Create the directory and init the repo**

Run:
```powershell
New-Item -ItemType Directory -Force 'C:/Users/nacho/git/LoomN' | Out-Null
git -C C:/Users/nacho/git/LoomN init
```
Expected: `Initialized empty Git repository in C:/Users/nacho/git/LoomN/.git/`

- [ ] **Step 2: Write `.gitignore`**

Create `C:/Users/nacho/git/LoomN/.gitignore`:
```gitignore
# Build output
build/
out/
cmake-build-*/

# Visual Studio / MSVC
.vs/
*.user
*.aps
*.pdb
*.ilk
*.obj

# OS
Thumbs.db
.DS_Store
```

- [ ] **Step 3: Write a minimal top-level `CMakeLists.txt`**

Create `C:/Users/nacho/git/LoomN/CMakeLists.txt`:
```cmake
cmake_minimum_required(VERSION 3.22)
project(LoomN VERSION 0.0.1 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
```

- [ ] **Step 4: Write `README.md`**

Create `C:/Users/nacho/git/LoomN/README.md`:
```markdown
# LoomN

Native (C++/JUCE) port of Loom. Standalone + VST3 music workstation.

See the design spec and implementation plans in the sibling `tb303-synth` repo
under `docs/superpowers/`.

## Build (Windows, MSVC, Visual Studio 2022 generator)

```powershell
cmake -S . -B build
cmake --build build --config Debug
ctest --test-dir build -C Debug --output-on-failure
```

`loom_core` is JUCE-free and unit-tested in isolation. The `juce_check` target
exists only to prove JUCE compiles under this toolchain.
```

- [ ] **Step 5: Verify the empty project configures**

Run:
```powershell
cmake -S C:/Users/nacho/git/LoomN -B C:/Users/nacho/git/LoomN/build
```
Expected: output ends with `-- Configuring done`, `-- Generating done`, and `-- Build files have been written to: C:/Users/nacho/git/LoomN/build`. A `LoomN.sln` exists under `build/`. No errors.

- [ ] **Step 6: Commit**

Run:
```powershell
git -C C:/Users/nacho/git/LoomN add .gitignore README.md CMakeLists.txt
git -C C:/Users/nacho/git/LoomN commit -m @'
chore: scaffold LoomN repo (CMake skeleton, gitignore, README)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```
Expected: a commit is created; `git -C C:/Users/nacho/git/LoomN status` shows a clean tree (apart from the untracked `build/`, which `.gitignore` excludes).

---

### Task 2: Wire test dependencies and prove the Catch2 harness runs

**Files:**
- Modify: `C:/Users/nacho/git/LoomN/CMakeLists.txt` (add nlohmann/json + Catch2 fetch, test subdir)
- Create: `C:/Users/nacho/git/LoomN/test/CMakeLists.txt`
- Create: `C:/Users/nacho/git/LoomN/test/test_smoke.cpp`
- Create: `C:/Users/nacho/git/LoomN/src/core/CMakeLists.txt` (stub so the test can link nothing yet)

> Note: `loom_core` proper is created in Task 4. For Task 2 the test target links only Catch2, proving the harness independently of our code.

- [ ] **Step 1: Write a trivial failing test first**

Create `C:/Users/nacho/git/LoomN/test/test_smoke.cpp`:
```cpp
#include <catch2/catch_test_macros.hpp>

TEST_CASE("catch2 harness runs", "[smoke]") {
    REQUIRE(1 + 1 == 3); // intentionally wrong — we want to SEE it fail first
}
```

- [ ] **Step 2: Replace the top-level `CMakeLists.txt` with one that fetches deps**

Overwrite `C:/Users/nacho/git/LoomN/CMakeLists.txt` with:
```cmake
cmake_minimum_required(VERSION 3.22)
project(LoomN VERSION 0.0.1 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(LOOMN_BUILD_TESTS "Build loom_core unit tests" ON)

include(FetchContent)

FetchContent_Declare(nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG v3.11.3
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(nlohmann_json)

add_subdirectory(src/core)

if(LOOMN_BUILD_TESTS)
  FetchContent_Declare(Catch2
    GIT_REPOSITORY https://github.com/catchorg/Catch2.git
    GIT_TAG v3.7.1
    GIT_SHALLOW TRUE)
  FetchContent_MakeAvailable(Catch2)
  list(APPEND CMAKE_MODULE_PATH ${catch2_SOURCE_DIR}/extras)
  enable_testing()
  add_subdirectory(test)
endif()
```

- [ ] **Step 3: Create a placeholder `src/core/CMakeLists.txt`**

Create `C:/Users/nacho/git/LoomN/src/core/CMakeLists.txt`:
```cmake
# loom_core — JUCE-free session model + JSON parsing.
# Sources are added in Task 4+. For now define an INTERFACE placeholder so the
# top-level add_subdirectory() succeeds before any core code exists.
add_library(loom_core INTERFACE)
target_include_directories(loom_core INTERFACE ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(loom_core INTERFACE nlohmann_json::nlohmann_json)
```

- [ ] **Step 4: Create `test/CMakeLists.txt`**

Create `C:/Users/nacho/git/LoomN/test/CMakeLists.txt`:
```cmake
add_executable(loom_tests
  test_smoke.cpp
)
target_link_libraries(loom_tests PRIVATE loom_core Catch2::Catch2WithMain)
target_compile_features(loom_tests PRIVATE cxx_std_17)

# Copy the fixtures dir next to the test exe so tests find them via a relative path.
add_custom_command(TARGET loom_tests POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_directory
    ${CMAKE_CURRENT_SOURCE_DIR}/fixtures
    $<TARGET_FILE_DIR:loom_tests>/fixtures)

include(Catch)
catch_discover_tests(loom_tests
  WORKING_DIRECTORY $<TARGET_FILE_DIR:loom_tests>)
```

- [ ] **Step 5: Create an empty fixtures dir so the POST_BUILD copy succeeds**

Run:
```powershell
New-Item -ItemType Directory -Force 'C:/Users/nacho/git/LoomN/test/fixtures' | Out-Null
New-Item -ItemType File -Force 'C:/Users/nacho/git/LoomN/test/fixtures/.gitkeep' | Out-Null
```

- [ ] **Step 6: Configure (first fetch — allow up to 10 min) and build**

Run:
```powershell
cmake -S C:/Users/nacho/git/LoomN -B C:/Users/nacho/git/LoomN/build
cmake --build C:/Users/nacho/git/LoomN/build --config Debug
```
Expected: configure clones nlohmann/json and Catch2; build compiles `loom_tests.exe`. Build succeeds.

- [ ] **Step 7: Run the test and verify it FAILS (red)**

Run:
```powershell
ctest --test-dir C:/Users/nacho/git/LoomN/build -C Debug --output-on-failure
```
Expected: FAILURE. Output contains `REQUIRE( 1 + 1 == 3 )` with `1 + 1 == 3` expanding to `2 == 3`, and `0% tests passed`.

- [ ] **Step 8: Fix the assertion (green)**

Edit `C:/Users/nacho/git/LoomN/test/test_smoke.cpp`, change the body to:
```cpp
#include <catch2/catch_test_macros.hpp>

TEST_CASE("catch2 harness runs", "[smoke]") {
    REQUIRE(1 + 1 == 2);
}
```

- [ ] **Step 9: Rebuild, re-run, verify it PASSES**

Run:
```powershell
cmake --build C:/Users/nacho/git/LoomN/build --config Debug
ctest --test-dir C:/Users/nacho/git/LoomN/build -C Debug --output-on-failure
```
Expected: `100% tests passed, 0 tests failed out of 1`.

- [ ] **Step 10: Commit**

Run:
```powershell
git -C C:/Users/nacho/git/LoomN add CMakeLists.txt src/core/CMakeLists.txt test/CMakeLists.txt test/test_smoke.cpp test/fixtures/.gitkeep
git -C C:/Users/nacho/git/LoomN commit -m @'
build: wire nlohmann/json + Catch2 via FetchContent; smoke test green

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```
Expected: commit created.

---

### Task 3: Prove JUCE compiles under this toolchain (de-risk)

**Files:**
- Modify: `C:/Users/nacho/git/LoomN/CMakeLists.txt` (add optional JUCE fetch + `juce_check` target)
- Create: `C:/Users/nacho/git/LoomN/juce/juce_check.cpp`

- [ ] **Step 1: Write the trivial JUCE program**

Create `C:/Users/nacho/git/LoomN/juce/juce_check.cpp`:
```cpp
#include <juce_core/juce_core.h>
#include <iostream>

int main() {
    std::cout << "JUCE version: "
              << juce::SystemStats::getJUCEVersion().toStdString()
              << std::endl;
    return 0;
}
```

- [ ] **Step 2: Add the JUCE fetch + target to `CMakeLists.txt`**

Append to the end of `C:/Users/nacho/git/LoomN/CMakeLists.txt`:
```cmake
option(LOOMN_BUILD_JUCE_CHECK "Fetch JUCE and build a juce_core sanity target" ON)

if(LOOMN_BUILD_JUCE_CHECK)
  FetchContent_Declare(juce
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG 8.0.4
    GIT_SHALLOW TRUE)
  FetchContent_MakeAvailable(juce)

  juce_add_console_app(juce_check PRODUCT_NAME "JUCE Check")
  target_sources(juce_check PRIVATE juce/juce_check.cpp)
  target_compile_definitions(juce_check PRIVATE
    JUCE_USE_CURL=0
    JUCE_WEB_BROWSER=0
    JUCE_STANDALONE_APPLICATION=1)
  target_link_libraries(juce_check PRIVATE
    juce::juce_core
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags)
endif()
```

- [ ] **Step 3: Reconfigure (fetches JUCE — allow up to 10 min) and build only `juce_check`**

Run:
```powershell
cmake -S C:/Users/nacho/git/LoomN -B C:/Users/nacho/git/LoomN/build
cmake --build C:/Users/nacho/git/LoomN/build --config Debug --target juce_check
```
Expected: JUCE is cloned; `juce_check` compiles and links against `juce_core` with **no errors**. This is the de-risk: MSVC successfully builds JUCE on this machine.

> If the `8.0.4` tag fails to fetch: open <https://github.com/juce-framework/JUCE/tags>, pick the newest `8.0.x`, update `GIT_TAG`, and re-run Step 3.

- [ ] **Step 4: Run `juce_check` to confirm it executes**

Run:
```powershell
& 'C:/Users/nacho/git/LoomN/build/juce_check_artefacts/Debug/JUCE Check.exe'
```
Expected: prints a line like `JUCE version: 8.0.4`. (If the artefact path differs, locate the built exe under `build/juce_check_artefacts/`.)

- [ ] **Step 5: Confirm the full build + tests still pass**

Run:
```powershell
cmake --build C:/Users/nacho/git/LoomN/build --config Debug
ctest --test-dir C:/Users/nacho/git/LoomN/build -C Debug --output-on-failure
```
Expected: build succeeds; `100% tests passed`.

- [ ] **Step 6: Commit**

Run:
```powershell
git -C C:/Users/nacho/git/LoomN add CMakeLists.txt juce/juce_check.cpp
git -C C:/Users/nacho/git/LoomN commit -m @'
build: prove JUCE 8 compiles under MSVC via juce_check console target

Throwaway de-risk target linking juce_core only. Confirms the toolchain
builds JUCE before any real audio code is written.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```
Expected: commit created.

---

### Task 4: Define the core data structs (`SessionModel.h`)

**Files:**
- Create: `C:/Users/nacho/git/LoomN/src/core/SessionModel.h`
- Modify: `C:/Users/nacho/git/LoomN/src/core/CMakeLists.txt` (promote `loom_core` from INTERFACE to STATIC)
- Modify: `C:/Users/nacho/git/LoomN/test/CMakeLists.txt` (add `test_session_json.cpp`)
- Create: `C:/Users/nacho/git/LoomN/test/test_session_json.cpp` (construct-the-structs test)

- [ ] **Step 1: Write a test that constructs the structs**

Create `C:/Users/nacho/git/LoomN/test/test_session_json.cpp`:
```cpp
#include <catch2/catch_test_macros.hpp>
#include "SessionModel.h"

using namespace loom;

TEST_CASE("SessionModel structs default-construct and hold values", "[model]") {
    NoteEvent n{0, 22, 36, 80};
    REQUIRE(n.start == 0);
    REQUIRE(n.duration == 22);
    REQUIRE(n.midi == 36);
    REQUIRE(n.velocity == 80);

    SessionClip clip;
    clip.id = "clip-a";
    clip.lengthBars = 2;
    clip.notes.push_back(n);
    REQUIRE(clip.notes.size() == 1);
    REQUIRE(clip.notes[0].midi == 36);

    SessionLane lane;
    lane.id = "tb-303-1";
    lane.engineId = "tb303";
    lane.clips.push_back(clip);          // a real clip
    lane.clips.push_back(std::nullopt);  // an empty slot
    REQUIRE(lane.clips.size() == 2);
    REQUIRE(lane.clips[0].has_value());
    REQUIRE_FALSE(lane.clips[1].has_value());

    SessionState st;
    st.lanes.push_back(lane);
    REQUIRE(st.lanes.size() == 1);
    REQUIRE(st.globalQuantize == "1/1");
}
```

- [ ] **Step 2: Write `SessionModel.h`**

Create `C:/Users/nacho/git/LoomN/src/core/SessionModel.h`:
```cpp
#pragma once
// Pure data model — a 1:1 mirror of the web project's SessionState
// (src/session/session.ts). No JUCE, no JSON, no logic. Data only.

#include <string>
#include <vector>
#include <optional>
#include <map>

namespace loom {

// Mirrors NoteEvent (src/core/notes.ts). Times are in ticks at
// TICKS_PER_QUARTER = 96 resolution (TICKS_PER_STEP = 24 = one 16th).
// velocity >= 100 means accent.
struct NoteEvent {
    int start = 0;     // ticks from clip start
    int duration = 0;  // ticks
    int midi = 0;      // 0-127
    int velocity = 0;  // 0-127
};

// Mirrors ClipEnvelope (src/session/session.ts).
struct ClipEnvelope {
    std::string paramId;
    std::vector<double> values;
    bool enabled = true;
    bool stepped = false;
};

// Mirrors ClipSample. Parsed structurally this phase; playback is a later phase.
struct ClipSample {
    std::string sampleId;
    std::string mode = "loop";          // "loop" | "song"
    std::optional<double> originalBpm;
    bool warp = false;
    double trimStart = 0.0;             // seconds
    double trimEnd = 0.0;              // seconds
    std::optional<double> gain;         // linear, default 1 when absent
};

// Mirrors SessionClip.
struct SessionClip {
    std::string id;
    std::optional<std::string> name;
    std::optional<std::string> color;
    int lengthBars = 1;
    std::optional<std::string> launchQuantize;
    std::vector<NoteEvent> notes;
    std::vector<ClipEnvelope> envelopes;
    std::optional<ClipSample> sample;
};

// Mirrors the parsed subset of SessionLane.engineState.
// Only numeric params are modelled this phase (modulators/noteFx/sampler later).
struct EngineState {
    std::map<std::string, double> params;
};

// Mirrors SessionLane. clips may contain empty slots (JSON null) → nullopt.
struct SessionLane {
    std::string id;
    std::string engineId;
    std::optional<std::string> name;
    std::vector<std::optional<SessionClip>> clips;
    std::optional<std::string> launchQuantize;
    std::optional<EngineState> engineState;
    std::optional<std::string> enginePresetName;
};

// Mirrors SessionScene. clipPerLane maps laneId -> clip index (or null).
struct SessionScene {
    std::string id;
    std::optional<std::string> name;
    std::map<std::string, std::optional<int>> clipPerLane;
    std::map<std::string, std::string> presetPerLane;
};

// Mirrors SessionState (the bare clip-grid format used by demo JSON files).
struct SessionState {
    std::vector<SessionLane> lanes;
    std::vector<SessionScene> scenes;
    std::string globalQuantize = "1/1";
};

} // namespace loom
```

- [ ] **Step 3: Promote `loom_core` to a STATIC library**

Overwrite `C:/Users/nacho/git/LoomN/src/core/CMakeLists.txt`:
```cmake
# loom_core — JUCE-free session model + JSON parsing.
add_library(loom_core STATIC
  SessionModel.h
  SessionJson.h
  SessionJson.cpp
)
target_include_directories(loom_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(loom_core PUBLIC nlohmann_json::nlohmann_json)
target_compile_features(loom_core PUBLIC cxx_std_17)
```

> `SessionJson.h`/`.cpp` are referenced here but created in Task 5. To keep this task self-contained and buildable, create both as empty stubs now:

Create `C:/Users/nacho/git/LoomN/src/core/SessionJson.h`:
```cpp
#pragma once
// Declarations added in Task 5.
```
Create `C:/Users/nacho/git/LoomN/src/core/SessionJson.cpp`:
```cpp
// Implementation added in Task 5.
```

- [ ] **Step 4: Add the new test file to the test target**

Overwrite `C:/Users/nacho/git/LoomN/test/CMakeLists.txt`:
```cmake
add_executable(loom_tests
  test_smoke.cpp
  test_session_json.cpp
)
target_link_libraries(loom_tests PRIVATE loom_core Catch2::Catch2WithMain)
target_compile_features(loom_tests PRIVATE cxx_std_17)

add_custom_command(TARGET loom_tests POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_directory
    ${CMAKE_CURRENT_SOURCE_DIR}/fixtures
    $<TARGET_FILE_DIR:loom_tests>/fixtures)

include(Catch)
catch_discover_tests(loom_tests
  WORKING_DIRECTORY $<TARGET_FILE_DIR:loom_tests>)
```

- [ ] **Step 5: Reconfigure, build, run — verify green**

Run:
```powershell
cmake -S C:/Users/nacho/git/LoomN -B C:/Users/nacho/git/LoomN/build
cmake --build C:/Users/nacho/git/LoomN/build --config Debug
ctest --test-dir C:/Users/nacho/git/LoomN/build -C Debug --output-on-failure
```
Expected: build succeeds; `100% tests passed, 0 tests failed out of 2` (smoke + model construct).

- [ ] **Step 6: Commit**

Run:
```powershell
git -C C:/Users/nacho/git/LoomN add src/core/SessionModel.h src/core/SessionJson.h src/core/SessionJson.cpp src/core/CMakeLists.txt test/CMakeLists.txt test/test_session_json.cpp
git -C C:/Users/nacho/git/LoomN commit -m @'
feat(core): SessionModel structs mirroring the web SessionState

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

### Task 5: Parse notes + clips from JSON

**Files:**
- Modify: `C:/Users/nacho/git/LoomN/src/core/SessionJson.h`
- Modify: `C:/Users/nacho/git/LoomN/src/core/SessionJson.cpp`
- Create: `C:/Users/nacho/git/LoomN/test/fixtures/minimal-shape.json`
- Modify: `C:/Users/nacho/git/LoomN/test/test_session_json.cpp` (append a parsing test)

- [ ] **Step 1: Create the compact fixture**

Create `C:/Users/nacho/git/LoomN/test/fixtures/minimal-shape.json`:
```json
{
  "lanes": [
    {
      "id": "tb-303-1",
      "engineId": "tb303",
      "name": "303 1",
      "clips": [
        {
          "id": "clip-a",
          "lengthBars": 2,
          "notes": [
            { "start": 0, "duration": 22, "midi": 36, "velocity": 80 },
            { "start": 192, "duration": 22, "midi": 36, "velocity": 115 }
          ]
        },
        null
      ],
      "enginePresetName": "engine:Acid Classic",
      "engineState": { "params": { "bus.reverbSend": 0.1 } }
    },
    {
      "id": "subtractive-1",
      "engineId": "subtractive",
      "name": "Sub 1",
      "clips": [
        {
          "id": "clip-b",
          "lengthBars": 2,
          "notes": [ { "start": 0, "duration": 38, "midi": 48, "velocity": 80 } ],
          "envelopes": [
            { "paramId": "subtractive-1.filter.cutoff", "values": [0.3, 0.4, 0.5], "enabled": true, "stepped": false }
          ]
        }
      ]
    }
  ],
  "scenes": [
    { "id": "scene-1", "name": "A", "clipPerLane": { "tb-303-1": 0, "subtractive-1": 0 } }
  ],
  "globalQuantize": "1/1"
}
```

- [ ] **Step 2: Write the failing parse test**

Append to `C:/Users/nacho/git/LoomN/test/test_session_json.cpp`:
```cpp
#include "SessionJson.h"
#include <fstream>
#include <sstream>

namespace {
std::string readFixture(const std::string& name) {
    std::ifstream f("fixtures/" + name, std::ios::binary);
    REQUIRE(f.good());
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
}
} // namespace

TEST_CASE("parseSessionState reads clips and notes", "[json]") {
    const SessionState st = parseSessionState(readFixture("minimal-shape.json"));

    REQUIRE(st.lanes.size() == 2);

    const SessionLane& bass = st.lanes[0];
    REQUIRE(bass.id == "tb-303-1");
    REQUIRE(bass.engineId == "tb303");
    REQUIRE(bass.clips.size() == 2);
    REQUIRE(bass.clips[0].has_value());
    REQUIRE_FALSE(bass.clips[1].has_value());   // JSON null -> empty slot

    const SessionClip& clip = *bass.clips[0];
    REQUIRE(clip.id == "clip-a");
    REQUIRE(clip.lengthBars == 2);
    REQUIRE(clip.notes.size() == 2);
    REQUIRE(clip.notes[0].start == 0);
    REQUIRE(clip.notes[0].midi == 36);
    REQUIRE(clip.notes[0].duration == 22);
    REQUIRE(clip.notes[0].velocity == 80);
    REQUIRE(clip.notes[1].velocity == 115);     // accent
}
```

- [ ] **Step 3: Declare `parseSessionState` in the header**

Overwrite `C:/Users/nacho/git/LoomN/src/core/SessionJson.h`:
```cpp
#pragma once
#include "SessionModel.h"
#include <string>

namespace loom {

// Parse a bare SessionState JSON document (the clip-grid / demo format:
// top-level "lanes", "scenes", "globalQuantize"). Throws nlohmann::json
// exceptions on malformed input.
SessionState parseSessionState(const std::string& jsonText);

} // namespace loom
```

- [ ] **Step 4: Implement note + clip + (partial) lane + state parsing**

Overwrite `C:/Users/nacho/git/LoomN/src/core/SessionJson.cpp`:
```cpp
#include "SessionJson.h"
#include <nlohmann/json.hpp>

using nlohmann::json;

namespace loom {
namespace {

std::optional<std::string> optString(const json& j, const char* key) {
    if (auto it = j.find(key); it != j.end() && !it->is_null())
        return it->get<std::string>();
    return std::nullopt;
}

NoteEvent parseNote(const json& j) {
    NoteEvent n;
    n.start    = j.value("start", 0);
    n.duration = j.value("duration", 0);
    n.midi     = j.value("midi", 0);
    n.velocity = j.value("velocity", 0);
    return n;
}

SessionClip parseClip(const json& j) {
    SessionClip c;
    c.id         = j.value("id", std::string{});
    c.name       = optString(j, "name");
    c.color      = optString(j, "color");
    c.lengthBars = j.value("lengthBars", 1);
    c.launchQuantize = optString(j, "launchQuantize");
    if (auto it = j.find("notes"); it != j.end() && it->is_array())
        for (const auto& n : *it) c.notes.push_back(parseNote(n));
    return c;
}

SessionLane parseLane(const json& j) {
    SessionLane l;
    l.id       = j.value("id", std::string{});
    l.engineId = j.value("engineId", std::string{});
    l.name     = optString(j, "name");
    if (auto it = j.find("clips"); it != j.end() && it->is_array())
        for (const auto& c : *it) {
            if (c.is_null()) l.clips.push_back(std::nullopt);
            else            l.clips.push_back(parseClip(c));
        }
    l.enginePresetName = optString(j, "enginePresetName");
    return l;
}

} // namespace

SessionState parseSessionState(const std::string& jsonText) {
    SessionState st;
    const json j = json::parse(jsonText);
    if (auto it = j.find("lanes"); it != j.end() && it->is_array())
        for (const auto& l : *it) st.lanes.push_back(parseLane(l));
    st.globalQuantize = j.value("globalQuantize", std::string{"1/1"});
    return st;
}

} // namespace loom
```

- [ ] **Step 5: Build, run — verify green**

Run:
```powershell
cmake --build C:/Users/nacho/git/LoomN/build --config Debug
ctest --test-dir C:/Users/nacho/git/LoomN/build -C Debug --output-on-failure
```
Expected: `100% tests passed` (3 test cases now).

- [ ] **Step 6: Commit**

Run:
```powershell
git -C C:/Users/nacho/git/LoomN add src/core/SessionJson.h src/core/SessionJson.cpp test/fixtures/minimal-shape.json test/test_session_json.cpp
git -C C:/Users/nacho/git/LoomN commit -m @'
feat(core): parse lanes, clips, and notes from session JSON

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

### Task 6: Parse engineState, presets, and launch-quantize

**Files:**
- Modify: `C:/Users/nacho/git/LoomN/src/core/SessionJson.cpp`
- Modify: `C:/Users/nacho/git/LoomN/test/test_session_json.cpp`

- [ ] **Step 1: Write the failing test**

Append to `C:/Users/nacho/git/LoomN/test/test_session_json.cpp`:
```cpp
TEST_CASE("parseSessionState reads engineState params and preset name", "[json]") {
    const SessionState st = parseSessionState(readFixture("minimal-shape.json"));

    const SessionLane& bass = st.lanes[0];
    REQUIRE(bass.enginePresetName.has_value());
    REQUIRE(*bass.enginePresetName == "engine:Acid Classic");
    REQUIRE(bass.engineState.has_value());
    REQUIRE(bass.engineState->params.count("bus.reverbSend") == 1);
    REQUIRE(bass.engineState->params.at("bus.reverbSend") == Catch::Approx(0.1));

    // A lane with no engineState/preset leaves the optionals empty.
    const SessionLane& sub = st.lanes[1];
    REQUIRE_FALSE(sub.enginePresetName.has_value());
    REQUIRE_FALSE(sub.engineState.has_value());
}
```

> Note: `Catch::Approx` requires `#include <catch2/catch_approx.hpp>`. Add that include at the top of `test_session_json.cpp` alongside the existing includes:
```cpp
#include <catch2/catch_approx.hpp>
```

- [ ] **Step 2: Run — verify it FAILS**

Run:
```powershell
cmake --build C:/Users/nacho/git/LoomN/build --config Debug
ctest --test-dir C:/Users/nacho/git/LoomN/build -C Debug --output-on-failure
```
Expected: FAIL — `bass.engineState.has_value()` is false because `parseLane` does not yet read `engineState` or `launchQuantize`.

- [ ] **Step 3: Add the `parseEngineState` helper and wire it into `parseLane`**

In `C:/Users/nacho/git/LoomN/src/core/SessionJson.cpp`, add this helper inside the anonymous namespace, immediately **above** `parseLane`:
```cpp
EngineState parseEngineState(const json& j) {
    EngineState es;
    if (auto it = j.find("params"); it != j.end() && it->is_object())
        for (auto& [k, v] : it->items())
            if (v.is_number()) es.params[k] = v.get<double>();
    return es;
}
```
Then, in `parseLane`, add the `launchQuantize` and `engineState` reads. Replace the existing `parseLane` body with:
```cpp
SessionLane parseLane(const json& j) {
    SessionLane l;
    l.id       = j.value("id", std::string{});
    l.engineId = j.value("engineId", std::string{});
    l.name     = optString(j, "name");
    if (auto it = j.find("clips"); it != j.end() && it->is_array())
        for (const auto& c : *it) {
            if (c.is_null()) l.clips.push_back(std::nullopt);
            else            l.clips.push_back(parseClip(c));
        }
    l.launchQuantize = optString(j, "launchQuantize");
    if (auto it = j.find("engineState"); it != j.end() && it->is_object())
        l.engineState = parseEngineState(*it);
    l.enginePresetName = optString(j, "enginePresetName");
    return l;
}
```

Also add `launchQuantize` parsing to `parseClip` — replace its body with:
```cpp
SessionClip parseClip(const json& j) {
    SessionClip c;
    c.id         = j.value("id", std::string{});
    c.name       = optString(j, "name");
    c.color      = optString(j, "color");
    c.lengthBars = j.value("lengthBars", 1);
    c.launchQuantize = optString(j, "launchQuantize");
    if (auto it = j.find("notes"); it != j.end() && it->is_array())
        for (const auto& n : *it) c.notes.push_back(parseNote(n));
    return c;
}
```

- [ ] **Step 4: Build, run — verify green**

Run:
```powershell
cmake --build C:/Users/nacho/git/LoomN/build --config Debug
ctest --test-dir C:/Users/nacho/git/LoomN/build -C Debug --output-on-failure
```
Expected: `100% tests passed` (4 test cases).

- [ ] **Step 5: Commit**

Run:
```powershell
git -C C:/Users/nacho/git/LoomN add src/core/SessionJson.cpp test/test_session_json.cpp
git -C C:/Users/nacho/git/LoomN commit -m @'
feat(core): parse lane engineState params + preset name

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

### Task 7: Parse envelopes, clip samples, and scenes

**Files:**
- Modify: `C:/Users/nacho/git/LoomN/src/core/SessionJson.cpp`
- Modify: `C:/Users/nacho/git/LoomN/test/test_session_json.cpp`

- [ ] **Step 1: Write the failing test**

Append to `C:/Users/nacho/git/LoomN/test/test_session_json.cpp`:
```cpp
TEST_CASE("parseSessionState reads envelopes and scenes", "[json]") {
    const SessionState st = parseSessionState(readFixture("minimal-shape.json"));

    // Envelope on the subtractive lane's clip.
    const SessionClip& subClip = *st.lanes[1].clips[0];
    REQUIRE(subClip.envelopes.size() == 1);
    REQUIRE(subClip.envelopes[0].paramId == "subtractive-1.filter.cutoff");
    REQUIRE(subClip.envelopes[0].values.size() == 3);
    REQUIRE(subClip.envelopes[0].values.front() == Catch::Approx(0.3));
    REQUIRE(subClip.envelopes[0].enabled == true);
    REQUIRE(subClip.envelopes[0].stepped == false);

    // Scene.
    REQUIRE(st.scenes.size() == 1);
    const SessionScene& scene = st.scenes[0];
    REQUIRE(scene.id == "scene-1");
    REQUIRE(scene.name.has_value());
    REQUIRE(*scene.name == "A");
    REQUIRE(scene.clipPerLane.count("tb-303-1") == 1);
    REQUIRE(scene.clipPerLane.at("tb-303-1").has_value());
    REQUIRE(*scene.clipPerLane.at("tb-303-1") == 0);
}
```

- [ ] **Step 2: Run — verify it FAILS**

Run:
```powershell
cmake --build C:/Users/nacho/git/LoomN/build --config Debug
ctest --test-dir C:/Users/nacho/git/LoomN/build -C Debug --output-on-failure
```
Expected: FAIL — `subClip.envelopes` is empty and `st.scenes` is empty (neither is parsed yet).

- [ ] **Step 3: Add envelope + sample helpers, wire into `parseClip`, add scene parsing**

In `C:/Users/nacho/git/LoomN/src/core/SessionJson.cpp`, add these two helpers inside the anonymous namespace, **above** `parseClip`:
```cpp
ClipEnvelope parseEnvelope(const json& j) {
    ClipEnvelope e;
    e.paramId = j.value("paramId", std::string{});
    if (auto it = j.find("values"); it != j.end() && it->is_array())
        e.values = it->get<std::vector<double>>();
    e.enabled = j.value("enabled", true);
    e.stepped = j.value("stepped", false);
    return e;
}

ClipSample parseSample(const json& j) {
    ClipSample s;
    s.sampleId  = j.value("sampleId", std::string{});
    s.mode      = j.value("mode", std::string{"loop"});
    if (auto it = j.find("originalBpm"); it != j.end() && !it->is_null())
        s.originalBpm = it->get<double>();
    s.warp      = j.value("warp", false);
    s.trimStart = j.value("trimStart", 0.0);
    s.trimEnd   = j.value("trimEnd", 0.0);
    if (auto it = j.find("gain"); it != j.end() && !it->is_null())
        s.gain = it->get<double>();
    return s;
}
```
Replace `parseClip` with the version that also reads envelopes + sample:
```cpp
SessionClip parseClip(const json& j) {
    SessionClip c;
    c.id         = j.value("id", std::string{});
    c.name       = optString(j, "name");
    c.color      = optString(j, "color");
    c.lengthBars = j.value("lengthBars", 1);
    c.launchQuantize = optString(j, "launchQuantize");
    if (auto it = j.find("notes"); it != j.end() && it->is_array())
        for (const auto& n : *it) c.notes.push_back(parseNote(n));
    if (auto it = j.find("envelopes"); it != j.end() && it->is_array())
        for (const auto& e : *it) c.envelopes.push_back(parseEnvelope(e));
    if (auto it = j.find("sample"); it != j.end() && it->is_object())
        c.sample = parseSample(*it);
    return c;
}
```
Add a `parseScene` helper inside the anonymous namespace, **above** `parseSessionState`:
```cpp
SessionScene parseScene(const json& j) {
    SessionScene s;
    s.id   = j.value("id", std::string{});
    s.name = optString(j, "name");
    if (auto it = j.find("clipPerLane"); it != j.end() && it->is_object())
        for (auto& [k, v] : it->items()) {
            if (v.is_null()) s.clipPerLane[k] = std::nullopt;
            else            s.clipPerLane[k] = v.get<int>();
        }
    if (auto it = j.find("presetPerLane"); it != j.end() && it->is_object())
        for (auto& [k, v] : it->items())
            s.presetPerLane[k] = v.get<std::string>();
    return s;
}
```
Replace `parseSessionState` so it also reads scenes:
```cpp
SessionState parseSessionState(const std::string& jsonText) {
    SessionState st;
    const json j = json::parse(jsonText);
    if (auto it = j.find("lanes"); it != j.end() && it->is_array())
        for (const auto& l : *it) st.lanes.push_back(parseLane(l));
    if (auto it = j.find("scenes"); it != j.end() && it->is_array())
        for (const auto& s : *it) st.scenes.push_back(parseScene(s));
    st.globalQuantize = j.value("globalQuantize", std::string{"1/1"});
    return st;
}
```

- [ ] **Step 4: Build, run — verify green**

Run:
```powershell
cmake --build C:/Users/nacho/git/LoomN/build --config Debug
ctest --test-dir C:/Users/nacho/git/LoomN/build -C Debug --output-on-failure
```
Expected: `100% tests passed` (5 test cases).

- [ ] **Step 5: Commit**

Run:
```powershell
git -C C:/Users/nacho/git/LoomN add src/core/SessionJson.cpp test/test_session_json.cpp
git -C C:/Users/nacho/git/LoomN commit -m @'
feat(core): parse clip envelopes, samples, and scenes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

### Task 8: Load a real demo session end-to-end

**Files:**
- Create: `C:/Users/nacho/git/LoomN/test/fixtures/minimal-techno.json` (copied from the web repo)
- Modify: `C:/Users/nacho/git/LoomN/test/test_session_json.cpp`

- [ ] **Step 1: Copy the real demo into the fixtures dir**

Run:
```powershell
Copy-Item 'C:/Users/nacho/git/tb303-synth/public/demos/minimal-techno.json' 'C:/Users/nacho/git/LoomN/test/fixtures/minimal-techno.json'
```
Expected: the file exists at the destination. Confirm with `Test-Path 'C:/Users/nacho/git/LoomN/test/fixtures/minimal-techno.json'` → `True`.

- [ ] **Step 2: Write the smoke test against real data**

Append to `C:/Users/nacho/git/LoomN/test/test_session_json.cpp`:
```cpp
TEST_CASE("parseSessionState loads the real minimal-techno demo", "[json][smoke]") {
    const SessionState st = parseSessionState(readFixture("minimal-techno.json"));

    // The demo has at least the three boot lanes.
    REQUIRE(st.lanes.size() >= 3);

    // Find the TB-303 lane by id and verify its first clip / first note.
    const SessionLane* bass = nullptr;
    for (const auto& l : st.lanes)
        if (l.id == "tb-303-1") { bass = &l; break; }
    REQUIRE(bass != nullptr);
    REQUIRE(bass->engineId == "tb303");
    REQUIRE(*bass->enginePresetName == "engine:Acid Classic");
    REQUIRE(bass->engineState->params.at("bus.reverbSend") == Catch::Approx(0.1));

    REQUIRE(bass->clips.size() >= 1);
    REQUIRE(bass->clips[0].has_value());
    const SessionClip& clip0 = *bass->clips[0];
    REQUIRE(clip0.notes.size() == 4);          // verified from the demo file
    REQUIRE(clip0.notes[0].midi == 36);
    REQUIRE(clip0.notes[0].duration == 22);
    REQUIRE(clip0.notes[0].start == 0);

    // Find the subtractive lane and confirm an automation envelope parsed.
    const SessionLane* sub = nullptr;
    for (const auto& l : st.lanes)
        if (l.id == "subtractive-1") { sub = &l; break; }
    REQUIRE(sub != nullptr);
    bool foundCutoffEnvelope = false;
    for (const auto& maybeClip : sub->clips) {
        if (!maybeClip) continue;
        for (const auto& env : maybeClip->envelopes)
            if (env.paramId == "subtractive-1.filter.cutoff" && env.values.size() > 100)
                foundCutoffEnvelope = true;
    }
    REQUIRE(foundCutoffEnvelope);
}
```

- [ ] **Step 3: Build, run — verify green**

Run:
```powershell
cmake --build C:/Users/nacho/git/LoomN/build --config Debug
ctest --test-dir C:/Users/nacho/git/LoomN/build -C Debug --output-on-failure
```
Expected: `100% tests passed` (6 test cases). The real, full-size demo parses without throwing.

- [ ] **Step 4: Commit**

Run:
```powershell
git -C C:/Users/nacho/git/LoomN add test/fixtures/minimal-techno.json test/test_session_json.cpp
git -C C:/Users/nacho/git/LoomN commit -m @'
test(core): load the real minimal-techno demo end-to-end

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

### Task 9: Create the multi-root VS Code workspace + finalize

**Files:**
- Create: `C:/Users/nacho/git/loom.code-workspace` (in the git **parent** dir, not inside either repo)
- Modify: `C:/Users/nacho/git/LoomN/README.md`

- [ ] **Step 1: Create the workspace file**

Create `C:/Users/nacho/git/loom.code-workspace`:
```json
{
  "folders": [
    { "name": "tb303-synth (web · Claude Code root)", "path": "tb303-synth" },
    { "name": "LoomN (native)", "path": "LoomN" }
  ],
  "settings": {
    "files.associations": { "*.h": "cpp" },
    "cmake.sourceDirectory": "${workspaceFolder:LoomN (native)}"
  }
}
```

> Paths are relative to the workspace file's location (`C:/Users/nacho/git`). `tb303-synth` is listed first/primary so Claude Code stays rooted there (preserving session transcripts + memory, the whole reason for the shared workspace).

- [ ] **Step 2: Expand the LoomN README with the workspace note**

Append to `C:/Users/nacho/git/LoomN/README.md`:
```markdown

## Workspace

Open `C:/Users/nacho/git/loom.code-workspace` in VS Code to work on both the web
project (`tb303-synth`) and this native port together. Claude Code remains rooted
in `tb303-synth` so its session history and memory carry forward.

## Layout

- `src/core/` — `loom_core`, the JUCE-free session model + JSON parsing.
- `test/` — Catch2 unit tests over `loom_core`.
- `juce/` — `juce_check`, a throwaway target proving JUCE builds (removed in a later phase).
```

- [ ] **Step 3: Full clean build + test as a final gate**

Run:
```powershell
Remove-Item -Recurse -Force 'C:/Users/nacho/git/LoomN/build' -ErrorAction SilentlyContinue
cmake -S C:/Users/nacho/git/LoomN -B C:/Users/nacho/git/LoomN/build
cmake --build C:/Users/nacho/git/LoomN/build --config Debug
ctest --test-dir C:/Users/nacho/git/LoomN/build -C Debug --output-on-failure
```
Expected: clean configure (re-fetches deps), full build succeeds, `100% tests passed, 0 tests failed out of 6`.

- [ ] **Step 4: Commit the LoomN README change**

Run:
```powershell
git -C C:/Users/nacho/git/LoomN add README.md
git -C C:/Users/nacho/git/LoomN commit -m @'
docs: README workspace + layout notes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

- [ ] **Step 5: Verify final state**

Run:
```powershell
git -C C:/Users/nacho/git/LoomN log --oneline
git -C C:/Users/nacho/git/LoomN status --short
Test-Path 'C:/Users/nacho/git/loom.code-workspace'
```
Expected: ~8 commits listed; working tree clean (only `build/` untracked, which is gitignored); workspace file exists.

> The `loom.code-workspace` file lives in `C:/Users/nacho/git/` (outside both repos) and is therefore not committed to either. That is intentional — it is a local editor convenience, not project source.

---

## Phase exit criteria (the "done" definition for Phase 1)

- `C:/Users/nacho/git/LoomN` is its own git repo with a clean history of small commits.
- `cmake -S … -B … && cmake --build … --config Debug && ctest -C Debug` is green from a clean checkout.
- JUCE 8 is proven to compile under MSVC (the `juce_check` target builds and runs).
- `loom_core` (JUCE-free) parses the real `minimal-techno.json` demo into typed structs: lanes, clips, notes, engineState params, preset names, envelopes, scenes.
- The `loom.code-workspace` joins both repos with `tb303-synth` primary.

**Next phase (separate plan):** Phase 2 — Transport + LaneScheduler (sample-accurate, slide/accent), still JUCE-free and unit-tested with a simulated block clock. Then Phase 3 (DSP engines), Phase 4 (JUCE AudioProcessor + WASAPI + VST3), Phase 5 (native UI).

---

## Self-Review

**1. Spec coverage (Section 0 + the parts of Sections 1/3 this phase touches):**
- Section 0 "new separate repo LoomN" → Task 1. ✓
- Section 0 "own git repository (git init)" → Task 1 Step 1. ✓
- Section 0 "VS Code multi-root workspace, tb303-synth primary" → Task 9. ✓
- Section 0 "Claude Code driven from tb303-synth via absolute paths + git -C" → every command. ✓
- Section 0 "first task = scaffold LoomN" → Task 1. ✓
- Section 1 "registry compile-time" / Section 3 "transport/scheduler" / DSP / UI → explicitly deferred to later phases (stated in exit criteria). ✓ (intentional phase boundary, not a gap)
- Section 3 "core/ pure model mirroring SessionState, no JUCE, unit-tested" → Tasks 4–8. ✓
- Section 5 "loom_core static lib, no JUCE; Catch2; CMake; MSVC" → Tasks 2, 4. ✓
- Section 5 "relative assertions" → parsing tests assert exact parsed data (structural equality), and the one numeric value uses `Catch::Approx`; no absolute magnitude thresholds. ✓
- Spec open question "JSON lib" → resolved: nlohmann/json (keeps core JUCE-free). ✓
- Spec open question "test framework" → resolved: Catch2 v3. ✓

**2. Placeholder scan:** No "TBD/TODO/handle edge cases/similar to Task N". The `SessionJson.h/.cpp` stubs in Task 4 are explicitly labelled and immediately filled in Task 5 (with full code shown). All code steps show complete code. ✓

**3. Type consistency:** `parseSessionState` (Task 5 decl, used Tasks 5–8) — consistent name throughout. Struct field names (`engineState`, `enginePresetName`, `clipPerLane`, `lengthBars`) match `SessionModel.h` (Task 4) and the real JSON keys verified from `src/session/session.ts` and `public/demos/minimal-techno.json`. `EngineState::params` is `std::map<std::string,double>` everywhere. `clips` is `std::vector<std::optional<SessionClip>>` in both the struct and every test. `Catch::Approx` include added in Task 6 Step 1 before first use. ✓

No issues found.
