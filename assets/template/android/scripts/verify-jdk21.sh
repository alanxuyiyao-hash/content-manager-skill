#!/bin/sh

set -eu

if [ -z "${JAVA_HOME:-}" ]; then
  echo "JAVA_HOME must point to a JDK 21 installation to build Android." >&2
  exit 1
fi

java="$JAVA_HOME/bin/java"

if [ ! -x "$java" ]; then
  echo "JAVA_HOME does not contain an executable bin/java: $JAVA_HOME" >&2
  exit 1
fi

version="$("$java" -version 2>&1 | sed -n 's/.*version "\([0-9][0-9]*\).*/\1/p' | head -n 1)"

if [ "$version" != "21" ]; then
  echo "Android builds require JDK 21; detected Java ${version:-unknown}." >&2
  exit 1
fi
