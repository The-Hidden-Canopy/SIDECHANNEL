cmake_minimum_required(VERSION 3.24)

add_library(sidechannel_core STATIC
  src/core.cpp
  src/c_api.cpp
  src/sqlite_store.cpp
  third_party/sqlite/sqlite3.c
)
target_compile_features(sidechannel_core PUBLIC cxx_std_23)
target_include_directories(sidechannel_core PUBLIC include PRIVATE third_party/sqlite)
target_compile_definitions(sidechannel_core PUBLIC SIDECHANNEL_NATIVE_REFERENCE=1
  SQLITE_THREADSAFE=1 SQLITE_DEFAULT_MEMSTATUS=0 SQLITE_OMIT_LOAD_EXTENSION=1 SQLITE_DQS=0)

if (MSVC)
  set_source_files_properties(third_party/sqlite/sqlite3.c PROPERTIES COMPILE_OPTIONS "/W0")
endif()

if (MSVC)
  target_compile_options(sidechannel_core PRIVATE /W4 /permissive-)
else()
  target_compile_options(sidechannel_core PRIVATE -Wall -Wextra -Wpedantic)
endif()

add_executable(sidechannel-native
  apps/sidechannel-native/main.cpp
)
target_link_libraries(sidechannel-native PRIVATE sidechannel_core)

add_executable(sidechannel-core-test
  tests/core_test.cpp
)
target_link_libraries(sidechannel-core-test PRIVATE sidechannel_core)

add_executable(sidechannel-c-api-test
  tests/c_api_test.cpp
)
target_link_libraries(sidechannel-c-api-test PRIVATE sidechannel_core)

enable_testing()
add_test(NAME sidechannel-core-test COMMAND sidechannel-core-test)
add_test(NAME sidechannel-c-api-test COMMAND sidechannel-c-api-test)
