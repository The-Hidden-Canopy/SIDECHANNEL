cmake_minimum_required(VERSION 3.24)

add_library(sidechannel_core STATIC
  src/core.cpp
)
target_compile_features(sidechannel_core PUBLIC cxx_std_23)
target_include_directories(sidechannel_core PUBLIC include)
target_compile_definitions(sidechannel_core PUBLIC SIDECHANNEL_NATIVE_REFERENCE=1)

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

enable_testing()
add_test(NAME sidechannel-core-test COMMAND sidechannel-core-test)
