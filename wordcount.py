from pyspark.sql import SparkSession
import sys


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: python wordcount.py <input_path> <output_path>")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    spark = SparkSession.builder.appName("WordCount").getOrCreate()

    try:
        text_df = spark.read.text(input_path)

        word_counts = (
            text_df.rdd.flatMap(lambda row: row.value.split())
            .map(lambda word: (word.lower(), 1))
            .reduceByKey(lambda left, right: left + right)
            .toDF(["word", "count"])
        )

        word_counts.write.mode("overwrite").csv(output_path, header=True)
    finally:
        spark.stop()


if __name__ == "__main__":
    main()
