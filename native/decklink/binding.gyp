{
  "variables": {
    # Point this at your own copy of the DeckLink SDK. It is a free but
    # licence-gated download and is not vendored here.
    "decklink_sdk%": "<!(node -p \"process.env.DECKLINK_SDK_DIR || ''\")"
  },
  "targets": [
    {
      "target_name": "decklink",
      "sources": ["src/decklink.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "cflags_cc!": ["-fno-exceptions"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "include_dirs": ["<(decklink_sdk)/Mac/include", "<(decklink_sdk)"],
            # DeckLinkAPIDispatch.cpp provides CreateDeckLinkIteratorInstance()
            # by dlopening the installed framework, which is why nothing links
            # against Desktop Video directly.
            "sources": ["<(decklink_sdk)/Mac/include/DeckLinkAPIDispatch.cpp"],
            "link_settings": {
              "libraries": ["-framework CoreFoundation"]
            },
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_CXX_LIBRARY": "libc++",
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "MACOSX_DEPLOYMENT_TARGET": "11.0"
            }
          }
        ],
        [
          "OS=='linux'",
          {
            "include_dirs": ["<(decklink_sdk)/Linux/include", "<(decklink_sdk)"],
            "sources": ["<(decklink_sdk)/Linux/include/DeckLinkAPIDispatch.cpp"],
            "libraries": ["-ldl"],
            "cflags_cc": ["-std=c++17", "-fexceptions"]
          }
        ],
        [
          "OS=='win'",
          {
            # Windows reaches the API through COM rather than the dispatch
            # source, so there is no extra translation unit here.
            "include_dirs": ["<(decklink_sdk)/Win/include", "<(decklink_sdk)"],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 1,
                "AdditionalOptions": ["/std:c++17"]
              }
            }
          }
        ]
      ]
    }
  ]
}
